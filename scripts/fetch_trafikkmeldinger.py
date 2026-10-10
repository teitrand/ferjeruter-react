#!/usr/bin/env python3
"""Hent trafikkmeldingar frå Fjord1 sitt Ibexa-API og lagre som JSON."""

from __future__ import annotations

import base64
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

# www.fjord1.no/graphql svarar 404. Trafikkmeldingane er Ibexa-typen
# traffic_message og kan søkjast anonymt via REST-viewet under.
REST_URL = "https://www.fjord1.no/api/ezp/v2/views"
SOURCE_URL = "https://www.fjord1.no/trafikkmeldingar"
PAGE_SIZE = 50
MAX_MESSAGES = 500
OSLO = ZoneInfo("Europe/Oslo")
ROUTE_RE = re.compile(r"\b1136\b|trandal|standal|valderøy|store kalvøy|sæbø|skår", re.I)
# Hjørundfjorden (1136 Standal-Trandal-Sæbø-Skår, 1135 Sæbø-Leknes) pluss
# 1049 Festøya-Hundeidvika, som er vegen ut av fjorden.
LOCAL_ROUTE_RE = re.compile(r"\b(1136|1135|1049|1069)\b", re.I)
LOCAL_PLACE_RE = re.compile(
    r"trandal|standal|sæbø|skår|store kalvøy|valderøy|bjørke|urke|festøy|hundeidvik|solavåg",
    re.I,
)
NORMAL_RE = re.compile(r"normal drift", re.I)
CANCEL_RE = re.compile(r"innstilt|innstilling", re.I)
PARTIAL_CANCEL_RE = re.compile(
    r"følgjande avgangar|avgangar innstilt|avgang(?:en|ar)?\s+(?:kl\.?|klokka)",
    re.I,
)
DELAY_RE = re.compile(r"forsink", re.I)
CAPACITY_RE = re.compile(r"kapasitet|kapasistet|farleg last|farlig last", re.I)
KOMBI_RE = re.compile(r"kombinasjon|kombirute|kombinert rute", re.I)
HAS_1135_RE = re.compile(r"\b1135\b")
HAS_1136_RE = re.compile(r"\b1136\b")
HJORUNDFJORD_RE = re.compile(
    r"\b(?:1135|1136)\b|trandal|standal|sæbø|skår|lekne|valderøy|store kalvøy|"
    r"kombinasjon|kombirute|kombinert rute",
    re.I,
)
ONLY_1049_RE = re.compile(r"\b(?:1049|1069)\b|festøy|hundeidvik|solavåg", re.I)
VESSEL_UTFORT_RE = re.compile(r"utført av\s+(?:m/?f\.?\s*)?(geiranger|kvernes)", re.I)
VESSEL_NAME_RE = re.compile(r"\b(?:m/?f\.?\s*)?(geiranger|kvernes)\b", re.I)
SWITCH_KOMBI_RE = re.compile(
    r"(?:kombinasjon\w*|kombirute|kombinert rute).{0,80}"
    r"(?:frå|fra)\s+(?:klokka|kl\.?)\s*(?:ca\.?\s*)?(\d{1,2})[:.](\d{2})",
    re.I | re.S,
)
SWITCH_UTFORT_RE = re.compile(
    r"(?:utført|gjeld)\s+frå\s+(?:klokka\s+|kl\.?\s*)?(?:ca\.?\s*)?(\d{1,2})[:.](\d{2})",
    re.I,
)
ACTIVATE_CLOCK_RE = re.compile(
    r"normal drift.{0,40}(?:frå|fra)\s+(?:klokka|kl\.?)\s*(?:ca\.?\s*)?(\d{1,2})[:.](\d{2})",
    re.I | re.S,
)
WEEKDAY_RE = (
    r"(?:mandag|måndag|tysdag|tirsdag|onsdag|torsdag|fredag|laurdag|lørdag|søndag)\s+"
)
NUMDATE_RE = r"(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?"
WINDOW_RANGE_RE = re.compile(
    rf"(?:frå|fra)\s+(?:rutestart\s+)?(?:{WEEKDAY_RE})?{NUMDATE_RE}"
    rf"\s+(?:til(?:\s+og\s+med)?|tom)\s+(?:{WEEKDAY_RE})?{NUMDATE_RE}",
    re.I,
)
WINDOW_FROM_RE = re.compile(
    rf"(?:frå|fra)\s+(?:rutestart\s+)?(?:{WEEKDAY_RE})?{NUMDATE_RE}",
    re.I,
)
WINDOW_UNTIL_RE = re.compile(
    rf"til\s+og\s+med\s+(?:{WEEKDAY_RE})?{NUMDATE_RE}",
    re.I,
)
WINDOW_ALSO_RE = re.compile(
    rf"(?:også|òg)\s+(?:på\s+)?(?:{WEEKDAY_RE})?{NUMDATE_RE}",
    re.I,
)
# Fjord1 sitt interne sambandsnummer for rute 1136.
ROUTE_1136_CONNECTION = 132


def classify(text: str) -> str:
    """Klassifiser meldingstekst: normal, cancelled, delay, capacity eller info."""
    if not text:
        return "info"
    has_normal = bool(NORMAL_RE.search(text))
    has_cancel = bool(CANCEL_RE.search(text))
    has_delay = bool(DELAY_RE.search(text))
    has_capacity = bool(CAPACITY_RE.search(text))
    if has_cancel and has_normal:
        return "delay" if has_delay else "normal"
    if has_cancel:
        return "cancelled"
    if has_delay:
        return "delay"
    if has_normal:
        return "normal"
    if has_capacity:
        return "capacity"
    return "info"


def is_route_1136(heading: str, text: str, connection_number: int | None) -> bool:
    if connection_number == ROUTE_1136_CONNECTION:
        return True
    blob = f"{heading or ''} {text or ''}"
    return bool(ROUTE_RE.search(blob))


def is_partial_cancel(text: str) -> bool:
    """Nemnte enkeltavgangar, ikkje heile sambandet innstilt."""
    blob = text or ""
    if not CANCEL_RE.search(blob) and not re.search(r"kanseller", blob, re.I):
        return False
    return bool(PARTIAL_CANCEL_RE.search(blob))


def route_mode_from_text(text: str) -> str:
    """1136, 1135 eller kombi ut frå Fjord1-meldingstekst."""
    blob = text or ""
    has_normal = bool(NORMAL_RE.search(blob))
    has_cancel = bool(CANCEL_RE.search(blob))
    has_kombi = bool(KOMBI_RE.search(blob))
    has_1135 = bool(HAS_1135_RE.search(blob))
    has_1136 = bool(HAS_1136_RE.search(blob))
    if has_normal and has_cancel and not has_kombi:
        return "1136"
    if has_kombi or (has_cancel and has_1135 and has_1136):
        return "kombi"
    if has_cancel and has_1136 and not has_1135:
        return "1136" if is_partial_cancel(blob) else "1135"
    return "1136"


def is_1049_only(heading: str, text: str) -> bool:
    blob = f"{heading or ''} {text or ''}"
    return bool(ONLY_1049_RE.search(blob)) and not HJORUNDFJORD_RE.search(blob)


def is_route_control(heading: str, text: str, is_local: bool | None = None) -> bool:
    """Meldingar som kan byte 1136/1135/kombirute — ikkje berre 1049."""
    if is_partial_cancel(text):
        return False
    if is_1049_only(heading, text):
        return False
    if is_local:
        return True
    blob = f"{heading or ''} {text or ''}"
    return bool(HJORUNDFJORD_RE.search(blob))


def _ref_date(published: str | None) -> date:
    if published:
        try:
            instant = datetime.fromisoformat(published.replace("Z", "+00:00"))
            if instant.tzinfo is None:
                instant = instant.replace(tzinfo=OSLO)
            return instant.astimezone(OSLO).date()
        except ValueError:
            pass
    return datetime.now(OSLO).date()


def _parse_numdate(day: str, month: str, year: str | None, ref: date):
    try:
        d, m = int(day), int(month)
    except (TypeError, ValueError):
        return None
    if m < 1 or m > 12 or d < 1 or d > 31:
        return None
    if year:
        y = int(year)
        if y < 100:
            y += 2000
    else:
        y = ref.year
        try:
            candidate = date(y, m, d)
        except ValueError:
            return None
        if (ref - candidate).days > 45:
            y += 1
    try:
        return date(y, m, d)
    except ValueError:
        return None


def window_from_text(text: str, published: str | None = None) -> dict | None:
    """Les «frå 14.06 til 18.06», «frå rutestart fredag 05.06» og «også på laurdag 19.09»."""
    blob = text or ""
    ref = _ref_date(published)
    match = WINDOW_RANGE_RE.search(blob)
    if match:
        start = _parse_numdate(match.group(1), match.group(2), match.group(3), ref)
        end = _parse_numdate(match.group(4), match.group(5), match.group(6), ref)
        if start or end:
            return {
                "from": start.isoformat() if start else None,
                "to": end.isoformat() if end else None,
            }
    start = None
    from_match = WINDOW_FROM_RE.search(blob)
    if from_match:
        start = _parse_numdate(
            from_match.group(1), from_match.group(2), from_match.group(3), ref
        )
    end = None
    until_match = WINDOW_UNTIL_RE.search(blob)
    if until_match:
        end = _parse_numdate(
            until_match.group(1), until_match.group(2), until_match.group(3), ref
        )
    if start or end:
        return {
            "from": start.isoformat() if start else None,
            "to": end.isoformat() if end else None,
        }
    also_match = WINDOW_ALSO_RE.search(blob)
    if also_match:
        extra = _parse_numdate(
            also_match.group(1), also_match.group(2), also_match.group(3), ref
        )
        if extra:
            return {"from": None, "to": extra.isoformat()}
    return None


def _clock(hour: str, minute: str) -> str | None:
    h, m = int(hour), int(minute)
    if h > 23 or m > 59:
        return None
    return f"{h:02d}:{m:02d}:00"


def _before_mode(after: str, text: str) -> str:
    if after == "1136":
        return "kombi" if KOMBI_RE.search(text or "") else "1135"
    return "1136"


def switch_from_text(text: str, after: str | None = None) -> dict | None:
    """Skøyt berre når meldinga seier at tabellen byter («kombirute frå klokka»)."""
    blob = text or ""
    mode = after or route_mode_from_text(blob)
    match = SWITCH_KOMBI_RE.search(blob) or SWITCH_UTFORT_RE.search(blob)
    if not match:
        return None
    time = _clock(match.group(1), match.group(2))
    if not time:
        return None
    return {"time": time, "quay": None, "before": _before_mode(mode, blob), "after": mode}


def activate_at_from_text(text: str) -> str | None:
    """Klokka «normal drift» startar. Ikkje eit skøyt i seg sjølv."""
    match = ACTIVATE_CLOCK_RE.search(text or "")
    if not match:
        return None
    return _clock(match.group(1), match.group(2))


def vessel_from_text(text: str) -> str | None:
    """Kvernes eller Geiranger når Fjord1 seier kva ferje som køyrer."""
    blob = text or ""
    performed = VESSEL_UTFORT_RE.search(blob)
    if performed:
        return performed.group(1).capitalize()
    names = {match.group(1).lower() for match in VESSEL_NAME_RE.finditer(blob)}
    if len(names) == 1:
        return names.pop().capitalize()
    return None


def is_local(heading: str, text: str, connection_number: int | None) -> bool:
    """Meldingar frå Hjørundfjorden og Festøya-Hundeidvika."""
    if is_route_1136(heading, text, connection_number):
        return True
    blob = f"{heading or ''} {text or ''}"
    return bool(LOCAL_ROUTE_RE.search(blob) or LOCAL_PLACE_RE.search(blob))


def parse_published(date_str: str, fallback_ts: int | None) -> str | None:
    if date_str:
        try:
            local = datetime.strptime(date_str.strip(), "%d.%m.%Y %H:%M:%S").replace(
                tzinfo=OSLO
            )
            return local.isoformat()
        except ValueError:
            try:
                local = datetime.strptime(date_str.strip(), "%d.%m.%Y %H:%M").replace(
                    tzinfo=OSLO
                )
                return local.isoformat()
            except ValueError:
                pass
    if fallback_ts:
        return datetime.fromtimestamp(fallback_ts, tz=timezone.utc).isoformat()
    return None


def iso_from_ts(ts: int | None) -> str | None:
    if not ts:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def normalize_node(node: dict) -> dict:
    heading = (node.get("heading") or "").strip()
    text = (node.get("content") or "").strip()
    connection = node.get("connectionNumber")
    valid_from_ts = (node.get("validFrom") or {}).get("timestamp")
    valid_to_ts = (node.get("validTo") or {}).get("timestamp")
    published = parse_published(node.get("date") or "", valid_from_ts)
    blob = f"{heading} {text}"
    local = is_local(heading, text, connection)
    return {
        "id": node.get("id"),
        "heading": heading,
        "text": text,
        "publishedAt": published,
        "validFrom": iso_from_ts(valid_from_ts),
        "validTo": iso_from_ts(valid_to_ts),
        "countyNumber": node.get("countyNumber"),
        "connectionNumber": connection,
        "important": bool(node.get("importantMessage")),
        "severity": classify(text),
        "isRoute1136": is_route_1136(heading, text, connection),
        "isLocal": local,
        "isRouteControl": is_route_control(heading, text, local),
        "routeMode": route_mode_from_text(blob),
        "routeWindow": window_from_text(blob, published),
        "activateAt": activate_at_from_text(blob),
        "vessel": vessel_from_text(blob),
        "routeSwitch": switch_from_text(blob),
    }


def content_id_to_message_id(content_id: int | str) -> str:
    """Same id-format som det gamle GraphQL-svaret (base64 av DomainContent:<id>)."""
    raw = f"DomainContent:{content_id}".encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


def _as_list(value) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _timestamp(value) -> int | None:
    if isinstance(value, dict):
        ts = value.get("timestamp")
        return ts if isinstance(ts, int) else None
    return None


def node_from_content(content: dict) -> dict:
    """Map eit Ibexa traffic_message-objekt til noden normalize_node forventar."""
    version = (content.get("CurrentVersion") or {}).get("Version") or {}
    fields = _as_list((version.get("Fields") or {}).get("field"))
    values = {
        field.get("fieldDefinitionIdentifier"): field.get("fieldValue")
        for field in fields
        if isinstance(field, dict)
    }
    heading = values.get("heading") or ""
    text = values.get("content") or ""
    date_str = values.get("date") or ""
    return {
        "id": content_id_to_message_id(content["_id"]),
        "heading": heading if isinstance(heading, str) else str(heading),
        "countyNumber": values.get("county_number"),
        "connectionNumber": values.get("connection_number"),
        "date": date_str if isinstance(date_str, str) else "",
        "content": text if isinstance(text, str) else str(text),
        "importantMessage": bool(values.get("important_message")),
        "validFrom": {"timestamp": _timestamp(values.get("valid_from"))},
        "validTo": {"timestamp": _timestamp(values.get("valid_to"))},
    }


def fetch_view_page(offset: int, timeout: int) -> dict:
    payload = json.dumps(
        {
            "ViewInput": {
                "identifier": "trafikkmeldingar",
                "Query": {
                    "Filter": {"ContentTypeIdentifierCriterion": "traffic_message"},
                    "limit": PAGE_SIZE,
                    "offset": offset,
                },
            }
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        REST_URL,
        data=payload,
        headers={
            "Content-Type": "application/vnd.ez.api.ViewInput+json",
            "Accept": "application/vnd.ez.api.View+json",
            "User-Agent": "Fergeorakelet/1.0 (+https://github.com/teitrand/fergeruter)",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        body = json.loads(response.read().decode("utf-8"))
    if body.get("ErrorMessage"):
        message = body["ErrorMessage"].get("errorMessage") or body["ErrorMessage"]
        raise RuntimeError(f"Fjord1 REST-feil: {message}")
    view = body.get("View")
    if not isinstance(view, dict) or not isinstance(view.get("Result"), dict):
        raise RuntimeError("Uventa svar frå Fjord1 REST-viewet")
    return view["Result"]


def fetch_messages(timeout: int = 30) -> list[dict]:
    offset = 0
    nodes: list[dict] = []
    total: int | None = None
    while offset < MAX_MESSAGES:
        result = fetch_view_page(offset, timeout)
        if total is None and isinstance(result.get("count"), int):
            total = result["count"]
        hits = _as_list((result.get("searchHits") or {}).get("searchHit"))
        if not hits:
            break
        for hit in hits:
            content = (hit.get("value") or {}).get("Content") if isinstance(hit, dict) else None
            if not isinstance(content, dict) or content.get("_id") is None:
                continue
            nodes.append(normalize_node(node_from_content(content)))
        offset += len(hits)
        if total is not None and offset >= total:
            break
        if len(hits) < PAGE_SIZE:
            break
    return nodes


def compact_message_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def message_merge_key(msg: dict) -> str:
    return f"{compact_message_text(msg.get('heading'))}|{compact_message_text(msg.get('text'))}"


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def message_is_held(msg: dict, now: datetime | None = None) -> bool:
    """Hald meldinga ut CMS-dagen (Oslo), éin time etter validTo, eller ut tekstvindauget."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    valid_to = parse_iso(msg.get("validTo"))
    if valid_to is None:
        return True
    if valid_to >= now - timedelta(hours=1):
        return True
    if now.astimezone(OSLO).date() <= valid_to.astimezone(OSLO).date():
        return True
    win = msg.get("routeWindow")
    if not isinstance(win, dict):
        win = window_from_text(
            f"{msg.get('heading') or ''} {msg.get('text') or ''}",
            msg.get("publishedAt"),
        )
    to_s = (win or {}).get("to")
    if to_s:
        try:
            return now.astimezone(OSLO).date() <= date.fromisoformat(to_s)
        except ValueError:
            return False
    return False


def message_should_be_retained(msg: dict, now: datetime | None = None) -> bool:
    """Behald berre når vi veit at meldinga framleis gjeld etter at Fjord1 droppa ho."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    win = msg.get("routeWindow")
    if not isinstance(win, dict):
        win = window_from_text(
            f"{msg.get('heading') or ''} {msg.get('text') or ''}",
            msg.get("publishedAt"),
        )
    to_s = (win or {}).get("to")
    if to_s:
        try:
            if now.astimezone(OSLO).date() <= date.fromisoformat(to_s):
                return True
        except ValueError:
            pass
    if not msg.get("validTo"):
        return False
    return message_is_held(msg, now)


def retain_held_messages(
    fresh: list[dict],
    previous: list[dict] | None,
    now: datetime | None = None,
) -> list[dict]:
    """Fjord1 droppar utgåtte CMS-meldingar; hald dei som framleis gjeld."""
    now = now or datetime.now(timezone.utc)
    by_key: dict[str, dict] = {}
    for msg in previous or []:
        if message_should_be_retained(msg, now):
            by_key[message_merge_key(msg)] = msg
    for msg in fresh or []:
        by_key[message_merge_key(msg)] = msg

    def published_at(msg: dict) -> datetime:
        return (
            parse_iso(msg.get("publishedAt") or msg.get("validFrom"))
            or datetime.min.replace(tzinfo=timezone.utc)
        )

    return sorted(by_key.values(), key=published_at, reverse=True)


def read_previous_messages(output: Path) -> list[dict]:
    if not output.exists():
        return []
    try:
        data = json.loads(output.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    messages = data.get("messages")
    return messages if isinstance(messages, list) else []


def build_payload(messages: list[dict], fetched_at: str | None = None) -> dict:
    return {
        "source": SOURCE_URL,
        "fetchedAt": fetched_at or datetime.now(timezone.utc).isoformat(),
        "messages": messages,
    }


def messages_body(payload: dict) -> dict:
    return {key: value for key, value in payload.items() if key != "fetchedAt"}


def default_output_path() -> Path:
    return Path(__file__).resolve().parents[1] / "data" / "trafikkmeldinger.json"


def write_if_changed(payload: dict, output: Path) -> bool:
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        existing = json.loads(output.read_text(encoding="utf-8"))
        if messages_body(existing) == messages_body(payload):
            return False
    output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return True


def main() -> int:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else default_output_path()
    try:
        messages = fetch_messages()
    except (urllib.error.URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"Kunne ikkje hente trafikkmeldingar: {exc}", file=sys.stderr)
        return 1
    messages = retain_held_messages(messages, read_previous_messages(output))
    payload = build_payload(messages)
    changed = write_if_changed(payload, output)
    if changed:
        print(f"Skreiv {len(messages)} meldingar til {output}")
    else:
        print(f"Trafikkmeldingane er uendra ({len(messages)} meldingar)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
