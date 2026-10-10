#!/usr/bin/env python3
"""Hent rutetabellane for 1136, 1135 og 1049 (Festøya–Hundeidvik) frå Entur.

Workflowen køyrer kvar dag. Fila blir berre skriven når innhaldet er endra.
Nettlesaren les den lagra fila.

Kombinasjonsruta ligg ikkje i Entur. Ho er transkribert frå FRAM-PDF i
data/kombirute.json (scripts/build_kombirute.py) og blir bytt ut når FRAM
legg ut ny PDF.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

ENTUR_URL = "https://api.entur.io/journey-planner/v3/graphql"
CLIENT_NAME = "teitrand-fergeruter"
LINE_IDS = {"1136": "MOR:Line:1136", "1135": "MOR:Line:1135", "1049": "MOR:Line:1049"}
QUAY_ALIASES = {"Lekneset": "Leknes"}

QUAY_SUFFIXES = (" ferjekai", " kai")

# Kaiane i Hjørundfjorden. Turar mellom desse og Valderøya/Store Kalvøy er
# forflytting utan passasjerar. PDF-en frå 17.08.26 har berre fotnote 1) og 3).
HJORUNDFJORD_QUAYS = ("Standal", "Trandal", "Sæbø", "Skår", "Leknes", "Bjørke", "Urke")

SIGNAL_RE = re.compile(r"min\.?\s*(\d+)\s*(timar|time|minutt|min)", re.I)
PHONE_RE = re.compile(r"tlf\.?\s*([\d\s]{6,})", re.I)

# Fotnote 1) og 3) i FRAM 1136-PDF frå 17.08.26, per Frå-celle.
# https://frammr.no/_f/p2/i3300c33e-2d47-4764-978b-6b2213d03b94/1136-standal-trandal-sabo-skar-valderoya-store-kalvoy-20260817.pdf
# 1) = 1 time, 3) = 3 timar. Ikkje heile turen (t.d. Standal 07:40 er vanleg,
# medan Trandal 08:00 laurdag på same tur er 1)).
PDF_SIGNAL_1136 = {
    "mtthf": {
        "Standal": {"0645": 1, "2000": 1},
        "Trandal": {"0705": 1, "1625": 1, "2020": 1},
        "Sæbø": {"0835": 1, "0920": 1, "1650": 1, "1745": 1},
        "Skår": {"0855": 1, "1710": 1},
    },
    "wednesday": {
        "Sæbø": {"0835": 1},
        "Valderøya": {"1110": 3, "1900": 3},
        "Store Kalvøy": {"1210": 3, "1925": 3},
    },
    "saturday": {
        "Standal": {"2000": 1},
        "Trandal": {"0800": 1, "1625": 1, "2020": 1},
        "Sæbø": {"0835": 1, "0920": 1, "1650": 1, "1745": 1},
        "Skår": {"0855": 1, "1710": 1},
        "Valderøya": {"1215": 3},
        "Store Kalvøy": {"1315": 3},
    },
    "sunday": {
        "Standal": {"2000": 1, "2040": 1},
        "Trandal": {"1020": 1, "1715": 1, "2020": 1, "2100": 1},
        "Sæbø": {"1050": 1, "1150": 1, "1750": 1, "1835": 1},
        "Skår": {"1120": 1, "1815": 1},
    },
}

SIGNAL_1H = {
    "minutesBefore": 60,
    "text": "Berre på signal min. 1 time før, tlf. 91 66 93 40",
    "phone": "91 66 93 40",
}
SIGNAL_3H = {
    "minutesBefore": 180,
    "text": "Berre på signal min. 3 timar før, tlf. 91 66 93 40",
    "phone": "91 66 93 40",
}

QUERY = """
query ($id: ID!) {
  line(id: $id) {
    id
    publicCode
    name
    serviceJourneys {
      id
      notices { text }
      passingTimes {
        requestStop
        quay { id name }
        departure { time }
        arrival { time }
      }
      activeDates
    }
  }
}
"""


def quay_place(name: str | None) -> str:
    if not name:
        return ""
    place = name.strip()
    for suffix in QUAY_SUFFIXES:
        if place.endswith(suffix):
            place = place[: -len(suffix)].strip()
            break
    return QUAY_ALIASES.get(place, place)


def clock(value: str | None) -> str | None:
    if not value:
        return None
    return value[:8]


def passing_departure(point: dict) -> str | None:
    return clock((point.get("departure") or {}).get("time"))


def passing_arrival(point: dict) -> str | None:
    return clock((point.get("arrival") or {}).get("time")) or passing_departure(point)


def day_group(iso: str) -> str:
    weekday = date.fromisoformat(iso).weekday()
    if weekday == 2:
        return "wednesday"
    if weekday == 5:
        return "saturday"
    if weekday == 6:
        return "sunday"
    return "mtthf"


def hhmm(clock: str) -> str:
    return clock[:2] + clock[3:5]


def pdf_signal_hours(from_quay: str, departure: str, dates: list[str]) -> int | None:
    """Timar frå PDF-fotnote, eller None.

    Høgtidsdagar som køyrer søndagstabell (t.d. 1. nyttårsdag) har Frå-tider
    som berre finst i søndagsgruppa. Då vinn den gruppa som faktisk har celle.
    """
    hits = {
        PDF_SIGNAL_1136.get(day_group(iso), {}).get(from_quay, {}).get(hhmm(departure))
        for iso in dates
    }
    hits.discard(None)
    if len(hits) == 1:
        return hits.pop()
    return None


def apply_fram_pdf_signal(public_code: str, legs: list[dict]) -> None:
    """PDF-fotnotane styrer 'På signal', ikkje Entur-meldinga på heile turen."""
    if public_code == "1135":
        # Sommar- og haust-PDF for 1135 har inga nummerert fotnote.
        for item in legs:
            item["signal"] = None
        return
    if public_code != "1136":
        return
    for item in legs:
        hours = pdf_signal_hours(
            item["from"], item["departure"], item.get("activeDates") or []
        )
        if hours is None:
            item["signal"] = None
            continue
        existing = item.get("signal") or {}
        if existing.get("minutesBefore") == hours * 60:
            continue
        template = SIGNAL_1H if hours == 1 else SIGNAL_3H
        item["signal"] = {
            "minutesBefore": hours * 60,
            "text": existing.get("text") or template["text"],
            "phone": existing.get("phone") or template["phone"],
        }


def parse_signal(notices: list[dict]) -> dict | None:
    """Gjer fotnoten om til minutt varsling, t.d. 'min. 1 time før' -> 60."""
    for notice in notices or []:
        text = (notice.get("text") or "").strip()
        match = SIGNAL_RE.search(text)
        if not match:
            continue
        amount = int(match.group(1))
        unit = match.group(2).lower()
        minutes = amount * 60 if unit.startswith("tim") else amount
        phone = None
        phone_match = PHONE_RE.search(text)
        if phone_match:
            phone = " ".join(phone_match.group(1).split())
        return {"minutesBefore": minutes, "text": text, "phone": phone}
    return None


def is_hjorundfjord(quay: str) -> bool:
    return quay in HJORUNDFJORD_QUAYS


def legs_from_journey(journey: dict) -> list[dict]:
    """Ein del per strekning mellom to påfølgjande anløp."""
    times = journey.get("passingTimes") or []
    if len(times) < 2:
        return []
    dates = sorted(set(journey.get("activeDates") or []))
    journey_id = journey.get("id") or ""
    notices = journey.get("notices") or []
    signal = parse_signal(notices)
    notice_texts = [n["text"].strip() for n in notices if (n.get("text") or "").strip()]
    legs = []
    for index, (start, end) in enumerate(zip(times, times[1:])):
        departure = passing_departure(start)
        arrival = passing_arrival(end)
        origin = quay_place(start.get("quay", {}).get("name"))
        destination = quay_place(end.get("quay", {}).get("name"))
        if not departure or not origin or not destination:
            continue
        legs.append(
            {
                "id": f"{journey_id}#{index}",
                "from": origin,
                "to": destination,
                "departure": departure,
                "arrival": arrival,
                "requestStop": bool(start.get("requestStop")),
                "signal": signal,
                "notices": notice_texts,
                "activeDates": dates,
            }
        )
    return legs


def build_legs(journeys: list[dict]) -> list[dict]:
    legs = []
    for journey in journeys:
        legs.extend(legs_from_journey(journey))
    legs.sort(key=lambda leg: (leg["departure"], leg["id"]))
    return legs


def timetable_body(payload: dict) -> dict:
    return {key: value for key, value in payload.items() if key != "fetchedAt"}


def fetch_line(line_id: str, timeout: int = 60) -> dict:
    req = urllib.request.Request(
        ENTUR_URL,
        data=json.dumps({"query": QUERY, "variables": {"id": line_id}}).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "ET-Client-Name": CLIENT_NAME,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        body = json.loads(response.read().decode("utf-8"))
    if body.get("errors"):
        raise RuntimeError(f"Entur GraphQL-feil: {body['errors']}")
    line = (body.get("data") or {}).get("line")
    if not line:
        raise RuntimeError(f"Entur gav ikkje linje {line_id}.")
    return line


def build_line(line: dict) -> dict:
    code = line.get("publicCode") or ""
    legs = build_legs(line.get("serviceJourneys") or [])
    apply_fram_pdf_signal(code, legs)
    return {
        "lineId": line.get("id") or "",
        "publicCode": code,
        "lineName": line.get("name") or "",
        "legs": legs,
    }


def build_payload(lines: dict[str, dict], fetched_at: str | None = None) -> dict:
    return {
        "source": ENTUR_URL,
        "fetchedAt": fetched_at or datetime.now(timezone.utc).isoformat(),
        "hjorundfjordQuays": list(HJORUNDFJORD_QUAYS),
        "lines": {code: build_line(line) for code, line in lines.items()},
    }


def default_output_path() -> Path:
    return Path(__file__).resolve().parents[1] / "data" / "ruter.json"


def write_if_changed(payload: dict, output: Path) -> bool:
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        existing = json.loads(output.read_text(encoding="utf-8"))
        if timetable_body(existing) == timetable_body(payload):
            return False
    output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return True


def main() -> int:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else default_output_path()
    try:
        fetched = {code: fetch_line(line_id) for code, line_id in LINE_IDS.items()}
        payload = build_payload(fetched)
    except (urllib.error.URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"Kunne ikkje hente rutetabell: {exc}", file=sys.stderr)
        return 1
    changed = write_if_changed(payload, output)
    counts = {code: len(line["legs"]) for code, line in payload["lines"].items()}
    summary = ", ".join(f"{code}={n}" for code, n in counts.items())
    if changed:
        print(f"Skreiv {summary} strekningar til {output}")
    else:
        print(f"Rutetabellen er uendra ({summary})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
