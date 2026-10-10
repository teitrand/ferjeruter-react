#!/usr/bin/env python3
"""Logg om signalturar vart bestilte, og ta vare på ei veke."""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ENTUR_URL = "https://api.entur.io/journey-planner/v3/graphql"
VM_URL = "https://api.entur.io/realtime/v1/rest/vm?datasetId=MOR&LineRef=MOR:Line:{line}"
ENTUR_CLIENT = "teitrand-fergeruter"
KEPT_DAYS = 7
OSLO = ZoneInfo("Europe/Oslo")
# Vaktvindauget er 04:00–22:40 UTC. 70 minutt er eitt uteblitt køyrd pluss litt kø.
# Nattpausen tel ikkje med i alderen. Ein sein updatedAt blir varsla, men
# jobben sluttar ikkje å logge av den grunn.
SIGNAL_LOG_MAX_AGE = timedelta(minutes=70)
SIGNAL_LOG_WATCH_START = 4 * 60
SIGNAL_LOG_WATCH_END = 22 * 60 + 40
ROOT = Path(__file__).resolve().parents[1]
ROUTES_PATH = ROOT / "data" / "ruter.json"
LOG_PATH = ROOT / "data" / "signalturar.json"
JOURNEY_RE = re.compile(r"MOR:ServiceJourney:[^#\s]+")
STOPS = {
    "Standal": "NSR:StopPlace:39713",
    "Trandal": "NSR:StopPlace:58521",
    "Sæbø": "NSR:StopPlace:58765",
    "Skår": "NSR:StopPlace:41385",
    "Leknes": "NSR:StopPlace:58766",
    "Valderøya": "NSR:StopPlace:61752",
    "Store Kalvøy": "NSR:StopPlace:58525",
}


def service_journey_id(value):
    match = JOURNEY_RE.search(str(value or ""))
    return match.group(0) if match else ""


def clock_minutes(value):
    hours, minutes, *_rest = str(value).split(":")
    return int(hours) * 60 + int(minutes)


def signal_legs(routes, date_iso):
    found = []
    for line in (routes.get("lines") or {}).values():
        for leg in line.get("legs") or []:
            if not leg.get("signal"):
                continue
            if date_iso not in (leg.get("activeDates") or []):
                continue
            found.append(leg)
    return found


def _after_arrival(leg, now_minutes):
    limit = leg.get("arrival") or leg.get("departure")
    return bool(limit) and now_minutes > clock_minutes(limit)


# Uttur som berre køyrer så ein retur kan gå, ligg tett på returen.
POSITIONING_GAP_MINUTES = 45


def _opposite_returns(leg, legs):
    """Seinare signaltur motsett veg, tett nok til å kunne vere retur etter ein tom uttur."""
    arrived = clock_minutes(leg.get("arrival") or leg.get("departure") or "00:00")
    departed = clock_minutes(leg.get("departure") or "00:00")
    found = []
    for other in legs:
        if other is leg or not other.get("signal"):
            continue
        if other.get("from") != leg.get("to") or other.get("to") != leg.get("from"):
            continue
        other_dep = clock_minutes(other.get("departure") or "99:99")
        if other_dep <= departed:
            continue
        gap = other_dep - arrived
        if gap < 0 or gap > POSITIONING_GAP_MINUTES:
            continue
        found.append(other)
    return found


def _return_has_booking(leg, cancelled_ids, actual_departures):
    """Returen har faktisk avgang. At kallet berre ligg i feeden er ikkje tinging."""
    journey = service_journey_id(leg.get("id"))
    if not journey or journey in cancelled_ids:
        return False
    return bool(actual_departures.get(journey))


def _return_pending(leg, now_minutes, cancelled_ids, actual_departures):
    """Returen er enno ikkje avgjord, så utturen kan vere posisjonering."""
    journey = service_journey_id(leg.get("id"))
    if not journey or journey in cancelled_ids or actual_departures.get(journey):
        return False
    return not _after_arrival(leg, now_minutes)


def _positioning_for_booked_return(leg, legs, cancelled_ids, actual_departures):
    """Tom uttur så ein seinare bestilt retur kan gå.

    Faktisk avgangstid åleine er ikkje bevis på bestilling for den turen.
    """
    return any(
        _return_has_booking(other, cancelled_ids, actual_departures)
        for other in _opposite_returns(leg, legs)
    )


def _positioning_pending(leg, legs, now_minutes, cancelled_ids, actual_departures):
    return any(
        _return_pending(other, now_minutes, cancelled_ids, actual_departures)
        for other in _opposite_returns(leg, legs)
    )


def observe_signal_trips(legs, now_minutes, cancelled_ids, seen_ids, actual_departures=None):
    """Alle signalturar i dag som har passert fristen, òg dei eit hol hoppa over.

    `actual_departures` er faktisk avgang frå Journey Planner, eventuelt fylt ut med
    bevis frå sanntid (VM): faktisk avgang, eller turen framme ved endekaia.

    Avlyst tur med slikt bevis er `gått`: ferja køyrde han utan at nokon hadde tinga.

    `booked` krev faktisk avgang (`actualDepartureTime`). At kallet ligg i
    feeden utan avlysing etter fristen er ikkje nok: avlysinga kan kome seinare,
    og då ville turen stå som tinga før han i det heile har gått.

    Etter ankomst er eit kall utan avlysing heller ikkje bevis. Manglar faktisk
    avgang, blir det ikkje gjetta. Unntaket for `booked` er ein tom uttur for
    ein seinare retur som sjølv har faktisk avgang. Då er statusen `gått`.
    Er returen enno ikkje avgjord, blir utturen ikkje skriven som `booked`.
    """
    actual_departures = actual_departures or {}
    observations = []
    for leg in legs:
        deadline = clock_minutes(leg["departure"]) - int(leg["signal"].get("minutesBefore") or 60)
        if now_minutes < deadline:
            continue
        journey = service_journey_id(leg.get("id"))
        if not journey:
            continue
        evidence_at = actual_departures.get(journey)
        positioning = _positioning_for_booked_return(leg, legs, cancelled_ids, actual_departures)
        if journey in cancelled_ids:
            # Avlyst, men faktisk avgang eller sanntid viser at ferja køyrde turen
            # (t.d. tom heim til Standal for natta). Då har han gått.
            if evidence_at:
                status = "gått"
            else:
                status = "skipped"
        elif journey in seen_ids and evidence_at:
            if positioning:
                status = "gått"
            elif _positioning_pending(leg, legs, now_minutes, cancelled_ids, actual_departures):
                continue
            else:
                status = "booked"
        else:
            continue
        record = {
            "id": journey,
            "from": leg.get("from"),
            "to": leg.get("to"),
            "departure": leg.get("departure"),
            "status": status,
        }
        if evidence_at:
            record["observedAt"] = evidence_at
            record["evidence"] = "departed"
        observations.append(record)
    return observations


def _departure_evidence(trip):
    return (trip or {}).get("evidence") == "departed"


def retract_unconfirmed_booked(existing, observations):
    """`booked` utan faktisk avgang skal ikkje bli ståande om neste sjekk ikkje stadfestar.

    Ein seinare avlysing, eller berre at vi ikkje lenger har avgangsbevis, vinn
    over eit tidlegare `booked` som berre kom av at kallet ikkje var avlyst.
    """
    updated = set()
    for obs in observations or []:
        journey = service_journey_id(obs.get("id"))
        if journey:
            updated.add(journey)
    kept = []
    for trip in existing or []:
        journey = service_journey_id(trip.get("id"))
        if (
            trip.get("status") == "booked"
            and not _departure_evidence(trip)
            and journey not in updated
        ):
            continue
        kept.append(trip)
    return kept


def apply_observations(existing, observations, observed_at=None):
    by_id = {}
    for trip in existing or []:
        journey = service_journey_id(trip.get("id"))
        if journey:
            by_id[journey] = {**trip, "id": journey}
    for obs in observations:
        journey = service_journey_id(obs.get("id"))
        if not journey:
            continue
        prev = by_id.get(journey)
        status = obs["status"]
        # `gått` betyr at ferja segla utan bestillingsbevis. Det vinn over ein
        # seinare avlysing, og blir ikkje skrive om til bestilt. Stadfesta
        # `booked` (faktisk avgang) blir ståande, unntatt om eit seinare svar
        # viser avlysing. `booked` utan avgangsbevis blir ikkje verande.
        # Avlyst blir ikkje bestilt.
        confirmed = _departure_evidence(prev)
        if prev and prev.get("status") == "gått":
            status = "gått"
        elif prev and prev.get("status") == "skipped" and status != "gått":
            status = "skipped"
        elif prev and prev.get("status") == "booked" and confirmed and status != "skipped":
            status = "booked"
        record = {**obs, "id": journey, "status": status}
        record.pop("evidence", None)
        if status in ("booked", "gått") and (_departure_evidence(obs) or _departure_evidence(prev)):
            record["evidence"] = "departed"
        if _departure_evidence(obs) and obs.get("observedAt") and not _departure_evidence(prev):
            observed = obs["observedAt"]
        else:
            observed = (prev or {}).get("observedAt") or obs.get("observedAt") or observed_at
        if observed:
            record["observedAt"] = observed
        if status == "skipped":
            skipped = (prev or {}).get("skippedAt") or observed_at
            if skipped:
                record["skippedAt"] = skipped
        by_id[journey] = record
    return sorted(by_id.values(), key=lambda trip: (trip.get("departure") or "", trip.get("from") or ""))


def prune_days(days, today, kept_days=KEPT_DAYS):
    oldest = (today - timedelta(days=kept_days - 1)).isoformat()
    return {iso: trips for iso, trips in (days or {}).items() if iso >= oldest}


# Entur svarar berre eit utval kalla. Er sida full, les vi resten av dagen.
PAGE_SIZE = 40
MAX_PAGES = 12


def calls_in_payload(payload):
    data = (payload or {}).get("data") or {}
    calls = []
    for place in data.values():
        if isinstance(place, dict):
            calls.extend(place.get("estimatedCalls") or [])
    return calls


def _call_on_day(call, day_iso):
    if not day_iso:
        return True
    aimed = call.get("aimedDepartureTime") or ""
    if not aimed:
        return True
    return str(aimed).startswith(day_iso)


def journey_ids_from_payload(payload, day_iso=None):
    cancelled = set()
    seen = set()
    for call in calls_in_payload(payload):
        if not _call_on_day(call, day_iso):
            continue
        journey = service_journey_id((call.get("serviceJourney") or {}).get("id"))
        if not journey:
            continue
        seen.add(journey)
        if call.get("cancellation"):
            cancelled.add(journey)
    return cancelled, seen


def actual_departures_from_payload(payload, day_iso=None):
    """Faktisk avgangstid, om Entur enno har ho. Fyrste treff vinn."""
    found = {}
    for call in calls_in_payload(payload):
        if not _call_on_day(call, day_iso):
            continue
        journey = service_journey_id((call.get("serviceJourney") or {}).get("id"))
        actual = call.get("actualDepartureTime")
        if journey and actual and journey not in found:
            found[journey] = actual
    return found


def payload_page_full(payload, page_size):
    data = (payload or {}).get("data") or {}
    for place in data.values():
        if not isinstance(place, dict):
            continue
        if len(place.get("estimatedCalls") or []) >= page_size:
            return True
    return False


def _parse_aimed(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=OSLO)
    return parsed


def next_page_start(payload):
    latest = None
    for call in calls_in_payload(payload):
        aimed = _parse_aimed(call.get("aimedDepartureTime"))
        if aimed is not None and (latest is None or aimed > latest):
            latest = aimed
    if latest is None:
        return None
    return latest + timedelta(seconds=1)


def cancellation_query(stop_ids, page_size=PAGE_SIZE):
    fields = []
    limit = int(page_size)
    for index, stop_id in enumerate(stop_ids):
        fields.append(
            f's{index}: stopPlace(id: "{stop_id}") {{'
            " estimatedCalls(startTime: $start, timeRange: 86400, "
            f"numberOfDepartures: {limit},"
            " includeCancelledTrips: true,"
            ' whiteListed: { lines: ["MOR:Line:1136", "MOR:Line:1135"] })'
            " { cancellation aimedDepartureTime actualDepartureTime serviceJourney { id } } }"
        )
    return "query Cancelled($start: DateTime!) { " + " ".join(fields) + " }"


def oslo_midnight_iso(moment):
    local = moment.astimezone(OSLO)
    start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.isoformat()


def _http_estimated(start_iso, stop_ids, page_size):
    body = json.dumps(
        {
            "query": cancellation_query(stop_ids, page_size),
            "variables": {"start": start_iso},
        }
    ).encode()
    request = urllib.request.Request(
        ENTUR_URL,
        data=body,
        headers={
            "ET-Client-Name": ENTUR_CLIENT,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode())
    if payload.get("errors") and not payload.get("data"):
        raise RuntimeError("Entur")
    return payload


def fetch_cancelled(moment, stop_ids, post=None, page_size=PAGE_SIZE):
    """Les heile driftsdagen, side for side, så eit hol ikkje mistar tidlege turar."""
    if not stop_ids:
        return set(), set(), {}
    if post is None:
        def post(start_iso, ids):
            return _http_estimated(start_iso, ids, page_size)

    local = moment.astimezone(OSLO)
    day_iso = local.date().isoformat()
    day_end = local.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    start = oslo_midnight_iso(moment)
    cancelled, seen, actual = set(), set(), {}
    seen_starts = set()
    for _page in range(MAX_PAGES):
        if start in seen_starts:
            break
        seen_starts.add(start)
        payload = post(start, stop_ids)
        page_cancelled, page_seen = journey_ids_from_payload(payload, day_iso)
        cancelled |= page_cancelled
        seen |= page_seen
        for journey, when in actual_departures_from_payload(payload, day_iso).items():
            actual.setdefault(journey, when)
        if not payload_page_full(payload, page_size):
            break
        nxt = next_page_start(payload)
        if nxt is None or nxt >= day_end:
            break
        start = nxt.isoformat()
        if start in seen_starts:
            break
    return cancelled, seen, actual


def _siri_value(value):
    if isinstance(value, list):
        value = value[0] if value else None
    if isinstance(value, dict):
        return value.get("value")
    return value


def _quay_place(name):
    text = re.sub(r"\s+(ferjekai|kai)$", "", str(name or "").strip(), flags=re.IGNORECASE)
    return "Leknes" if text == "Lekneset" else text


def _after_departure(when, leg, day_iso):
    """`when` (ISO-tid) er ved eller etter planlagd avgang for `leg` den dagen."""
    try:
        moment = datetime.fromisoformat(str(when).replace("Z", "+00:00"))
    except ValueError:
        return False
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=OSLO)
    local = moment.astimezone(OSLO)
    if day_iso and local.date().isoformat() != day_iso:
        return local.date().isoformat() > day_iso
    return local.hour * 60 + local.minute >= clock_minutes(leg.get("departure") or "00:00")


def vm_sailed_from_payload(payload, legs, day_iso):
    """Signalturar som sanntid (VM) viser at ferja har køyrt i dag.

    Bevis er faktisk avgang i MonitoredCall, eller at ferja er framme ved endekaia
    etter planlagd avgang (ActualArrivalTime, eller VehicleAtStop der). Entur sender ofte den siste
    aktiviteten ei stund etter at ValidUntilTime er ute, så sjølv ein gammal post
    for ein tur i dag er bevis for den turen.
    """
    by_journey = {service_journey_id(leg.get("id")): leg for leg in legs or []}
    deliveries = (((payload or {}).get("Siri") or {}).get("ServiceDelivery") or {}).get(
        "VehicleMonitoringDelivery"
    ) or []
    if isinstance(deliveries, dict):
        deliveries = [deliveries]
    found = {}
    for delivery in deliveries:
        activities = (delivery or {}).get("VehicleActivity") or []
        if isinstance(activities, dict):
            activities = [activities]
        for activity in activities:
            journey_data = (activity or {}).get("MonitoredVehicleJourney") or {}
            framed = journey_data.get("FramedVehicleJourneyRef") or {}
            journey = service_journey_id(framed.get("DatedVehicleJourneyRef"))
            leg = by_journey.get(journey)
            if not leg:
                continue
            frame = _siri_value(framed.get("DataFrameRef")) or ""
            origin = str(journey_data.get("OriginAimedDepartureTime") or "")
            if day_iso and not (str(frame).startswith(day_iso) or origin.startswith(day_iso)):
                continue
            call = journey_data.get("MonitoredCall") or {}
            stop = _quay_place(_siri_value(call.get("StopPointName")))
            at_dest = bool(stop) and stop == _quay_place(leg.get("to"))
            if stop and stop not in (_quay_place(leg.get("from")), _quay_place(leg.get("to"))):
                # Ferja er knytt til turen, men står ved ei anna kai (tomtur/ligg til kai): ikkje bevis for denne turen.
                continue
            when = None
            if call.get("ActualDepartureTime"):
                when = call.get("ActualDepartureTime")
            elif at_dest and call.get("ActualArrivalTime"):
                when = call.get("ActualArrivalTime")
            elif at_dest and call.get("VehicleAtStop") in (True, "true"):
                when = activity.get("RecordedAtTime")
            if when and not call.get("ActualDepartureTime") and not _after_departure(when, leg, day_iso):
                # Ved endekaia før rutetida: Entur kan ha kopla ferja til neste tur.
                when = None
            if when and journey not in found:
                found[journey] = when
    return found


def _http_vm(line):
    request = urllib.request.Request(
        VM_URL.format(line=line),
        headers={"ET-Client-Name": ENTUR_CLIENT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode())


def fetch_vm_sailed(routes, date_iso, legs, get=None):
    """Eitt VM-kall per linje som har signalturar i dag. Feil gjer ingenting: loggen går vidare."""
    get = get or _http_vm
    found = {}
    for line, data in (routes.get("lines") or {}).items():
        if not any(
            leg.get("signal") and date_iso in (leg.get("activeDates") or [])
            for leg in data.get("legs") or []
        ):
            continue
        try:
            payload = get(line)
        except Exception as error:  # noqa: BLE001 - sanntid er berre eit tillegg
            print(f"VM for {line} feila: {error}", file=sys.stderr)
            continue
        for journey, when in vm_sailed_from_payload(payload, legs, date_iso).items():
            found.setdefault(journey, when)
    return found


def update_log(
    existing,
    routes,
    moment,
    cancelled_ids,
    seen_ids=None,
    kept_days=KEPT_DAYS,
    actual_departures=None,
):
    local = moment.astimezone(OSLO)
    today = local.date()
    date_iso = today.isoformat()
    now_minutes = local.hour * 60 + local.minute
    legs = signal_legs(routes, date_iso)
    observations = observe_signal_trips(
        legs,
        now_minutes,
        cancelled_ids,
        seen_ids or set(),
        actual_departures,
    )
    days = dict((existing or {}).get("days") or {})
    prior = retract_unconfirmed_booked(days.get(date_iso) or [], observations)
    days[date_iso] = apply_observations(prior, observations, local.isoformat())
    days = prune_days(days, today, kept_days)
    return {
        "keptDays": kept_days,
        "updatedAt": local.isoformat(),
        "days": days,
    }


def _as_utc(moment):
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def log_check_expected(moment):
    utc = _as_utc(moment)
    minutes = utc.hour * 60 + utc.minute
    return SIGNAL_LOG_WATCH_START <= minutes <= SIGNAL_LOG_WATCH_END


def _parse_updated(previous):
    text = (previous or "").strip()
    if not text:
        return None
    try:
        updated = datetime.fromisoformat(text)
    except ValueError:
        return None
    if updated.tzinfo is None:
        updated = updated.replace(tzinfo=OSLO)
    return updated.astimezone(timezone.utc)


def log_age_minutes(previous, moment):
    """Minutt sidan siste hjarteslag, rekna frå 04:00 UTC om det er nyare."""
    updated = _parse_updated(previous)
    if updated is None:
        return None
    utc = _as_utc(moment)
    window_start = utc.replace(hour=4, minute=0, second=0, microsecond=0)
    baseline = max(updated, window_start)
    return (utc - baseline).total_seconds() / 60


def log_is_late(previous, moment=None):
    moment = moment or datetime.now(timezone.utc)
    if not log_check_expected(moment):
        return False
    age = log_age_minutes(previous, moment)
    if age is None:
        return True
    return age > SIGNAL_LOG_MAX_AGE.total_seconds() / 60


def require_recent(previous):
    if log_is_late(previous):
        print("Signalloggen er for gammal", file=sys.stderr)
        return 1
    return 0


def run_check(routes, existing, moment, fetch_cancelled_fn=None, fetch_vm_fn=None):
    """Éin sjekk: hent avlysingar og sanntid frå Entur og gje den oppdaterte loggen.

    Same logikk uansett kvar jobben køyrer (GitHub Actions eller heimeserveren, scripts/signaltur_server.py).
    `fetch_*_fn` finst for testar; standard er dei ekte Entur-kalla.
    """
    today = moment.date().isoformat()
    legs = signal_legs(routes, today)
    names = {leg.get("from") for leg in legs}
    stop_ids = [STOPS[name] for name in names if name in STOPS]
    cancelled, seen, actual = (fetch_cancelled_fn or fetch_cancelled)(moment, stop_ids)
    for journey, when in (fetch_vm_fn or fetch_vm_sailed)(routes, today, legs).items():
        actual.setdefault(journey, when)
    return update_log(existing, routes, moment, cancelled, seen, actual_departures=actual)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "--require-recent":
        previous = argv[1] if len(argv) > 1 else ""
        return require_recent(previous)
    routes = json.loads(ROUTES_PATH.read_text(encoding="utf-8"))
    existing = {}
    if LOG_PATH.exists():
        existing = json.loads(LOG_PATH.read_text(encoding="utf-8"))
    payload = run_check(routes, existing, datetime.now(OSLO))
    LOG_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
