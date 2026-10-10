#!/usr/bin/env python3
"""Signaltur-sjekken på heimeserveren (systemd-timer, collector/systemd/fergeruter-signaltur.*).

Same sjekk som GitHub-jobben (scripts/log_signalturar.py: run_check), men skriv loggen til
sanntid-workeren (POST /v1/signalturar) i staden for ein commit. Appen les loggen derfrå og
fell tilbake til data/signalturar.json på Pages. Éi køyring:

1. Rutetabellen (ruter.json) frå Pages; siste gode kopi i tilstandsmappa om Pages ikkje svarar.
2. Førre logg: den nyaste av workeren og Pages (så ingenting går tapt om GitHub-jobben var åleine ei stund).
3. Entur (avlysingar og sanntid) → ny logg med `updatedAt` = no.
4. POST til workeren med nøkkelen frå miljøet. Nøkkelen blir aldri skriven ut.

Miljø (same fil som innsamlaren, /etc/fergeruter/collector.env):
  FERGERUTER_SENDER_KEY    påkravd. Same nøkkel som innsamlaren sender med.
  FERGERUTER_SENDER_URL    grunn-URL til workeren (standard: produksjonsworkeren).
  FERGERUTER_DATA_BASE     der ruter.json og signalturar.json ligg på Pages (standard: produksjon).
  FERGERUTER_SIGNAL_STATE  mappe for siste gode kopi (standard: /var/lib/fergeruter/signaltur).
Utgangskode 0 = loggen er skriven (eller ein nyare låg alt der). 1 = feil, systemd merkjer køyringa som feila.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

DEFAULT_WORKER = "https://fergeruter-sanntid.fergeruter-teitrand.workers.dev"
DEFAULT_DATA_BASE = "https://teitrand.github.io/fergeruter/data/"
DEFAULT_STATE = "/var/lib/fergeruter/signaltur"
KEY_HEADER = "X-Fergeruter-Key"
USER_AGENT = "teitrand-fergeruter-signaltur/1"
TIMEOUT = 25


def say(message):
    print(message, flush=True)


def load_logger():
    path = Path(__file__).with_name("log_signalturar.py")
    spec = importlib.util.spec_from_file_location("log_signalturar_server", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def http_json(url, timeout=TIMEOUT):
    """GET som JSON. None ved feil (nettverk, status, ugyldig JSON): kjelda manglar då berre."""
    request = urllib.request.Request(url, headers={"Accept": "application/json", "Cache-Control": "no-cache", "User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as error:
        say(f"Hentar ikkje {url}: {error}")
        return None


def post_log(url, key, log, timeout=TIMEOUT):
    """POST loggen. Gjev HTTP-status (0 ved nettverksfeil). Nøkkelen kjem berre i headeren."""
    body = json.dumps({"schema": 1, "log": log}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", KEY_HEADER: key, "User-Agent": USER_AGENT},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except (urllib.error.URLError, OSError) as error:
        say(f"Nettverksfeil ved sending: {error.__class__.__name__}")
        return 0


def valid_log(log):
    return isinstance(log, dict) and isinstance(log.get("days"), dict)


def newest_log(logger, candidates):
    """Nyaste gyldige logg (etter `updatedAt`). Ingen gyldig gjev tom logg."""
    best, best_at = None, None
    for log in candidates:
        if not valid_log(log):
            continue
        at = logger._parse_updated(log.get("updatedAt"))
        if best is None or (at is not None and (best_at is None or at > best_at)):
            best, best_at = log, at
    return best or {}


def read_cache(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def write_cache(path, payload):
    path = Path(path)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    except OSError as error:
        say(f"Fekk ikkje lagra {path.name}: {error}")


def load_routes(data_base, state_dir, get=http_json):
    cache = Path(state_dir) / "ruter.json"
    routes = get(data_base + "ruter.json")
    if isinstance(routes, dict) and isinstance(routes.get("lines"), dict):
        write_cache(cache, routes)
        return routes
    cached = read_cache(cache)
    if isinstance(cached, dict) and isinstance(cached.get("lines"), dict):
        say("Brukar siste gode kopi av ruter.json.")
        return cached
    return None


def run_once(env, now=None, get=http_json, post=post_log, logger=None, check=None):
    """Éi køyring. Gjev utgangskode. `get`, `post` og `check` kan byttast ut i testar."""
    key = (env.get("FERGERUTER_SENDER_KEY") or "").strip()
    if not key:
        say("FERGERUTER_SENDER_KEY manglar.")
        return 1
    worker = (env.get("FERGERUTER_SENDER_URL") or DEFAULT_WORKER).rstrip("/")
    data_base = (env.get("FERGERUTER_DATA_BASE") or DEFAULT_DATA_BASE).rstrip("/") + "/"
    state_dir = env.get("FERGERUTER_SIGNAL_STATE") or DEFAULT_STATE
    logger = logger or load_logger()
    routes = load_routes(data_base, state_dir, get)
    if routes is None:
        say("Har ingen rutetabell (verken frå Pages eller cache).")
        return 1
    moment = now or datetime.now(logger.OSLO)
    existing = newest_log(logger, [get(f"{worker}/v1/signalturar"), get(data_base + "signalturar.json"), read_cache(Path(state_dir) / "signalturar.json")])
    try:
        log = (check or logger.run_check)(routes, existing, moment)
    except Exception as error:  # Entur nede e.a.: ingen ny logg, neste runde prøver att
        say(f"Sjekken feila: {error.__class__.__name__}: {error}")
        return 1
    status = post(f"{worker}/v1/signalturar", key, log)
    if status in (200, 204):
        write_cache(Path(state_dir) / "signalturar.json", log)
        today = log["updatedAt"][:10]
        say(f"Loggen er skriven ({log['updatedAt']}, {len(log['days'].get(today) or [])} signalturar i dag).")
        return 0
    if status == 409:
        say("Ein nyare logg låg alt i workeren. Hoppar over.")
        return 0
    if status == 429:
        say("Workeren avviste for tidleg (429). Neste runde.")
        return 0
    say(f"Workeren svara {status}.")
    return 1


def main():
    return run_once(os.environ)


if __name__ == "__main__":
    raise SystemExit(main())
