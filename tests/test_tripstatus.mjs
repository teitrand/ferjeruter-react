// Einingstestar for tripStatus i packages/core. Ingen global tilstand: alt kjem frå `ev`.
// Køyrer òg via test_status.mjs, sidan arbeidsflyta listar testfilene ein og ein.
import assert from "node:assert/strict";
import test from "node:test";
import { departureStateKey, leftOrigin, liveProvesSailed, tripStatus } from "../packages/core/index.js";

const DAY = "2026-10-08";
const J = (n) => `MOR:ServiceJourney:1136_${n}_9150000046000000`;

function leg(from, to, departure, arrival, n, signal = true) {
  return {
    id: `${J(n)}#0`,
    from,
    to,
    departure,
    arrival,
    ...(signal ? { signal: { minutesBefore: 60, phone: "91 66 93 40" } } : {}),
  };
}

const out = leg("Standal", "Trandal", "14:00:00", "14:15:00", 1);
const back = leg("Trandal", "Standal", "18:00:00", "18:15:00", 2);
const regular = leg("Standal", "Trandal", "07:00:00", "07:15:00", 3, false);
const dayLegs = [regular, out, back];
const min = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Bevis utan noko: i dag, ingen logg, ingen sanntid. */
function evidence(partial = {}) {
  return {
    date: DAY,
    today: DAY,
    live: null,
    dayLegs,
    dateLegs: dayLegs,
    log: { days: {} },
    cancelledJourneys: new Set(),
    actualDepartures: new Map(),
    sailedJourneys: new Set(),
    confirmedBooked: new Set(),
    messageCancelled: new Set(),
    clockNow: min("15:00"),
    ...partial,
  };
}

function logged(entries, date = DAY) {
  return { days: { [date]: entries } };
}

function liveAt(stopName, atStop, extra = {}) {
  return {
    validUntil: "2099-01-01T00:00:00Z",
    recordedAt: "2026-10-08T12:30:00Z",
    journeyRef: J(1),
    stopName,
    atStop,
    ...extra,
  };
}

test("tripStatus: vanleg avgang etter rutetabellen", () => {
  const status = tripStatus(regular, evidence(), min("06:00"));
  assert.equal(status.kind, "regular");
  assert.equal(status.source, "timetable");
  assert.equal(status.signal, false);
  assert.equal(departureStateKey(status, { today: true }), "countdown");
});

test("tripStatus: vanleg avgang avlyst hos Entur eller i trafikkmelding", () => {
  const entur = tripStatus(regular, evidence({ cancelledJourneys: new Set([J(3)]) }), min("06:00"));
  assert.equal(entur.kind, "cancelled");
  assert.equal(entur.source, "entur");
  const message = tripStatus(regular, evidence({ messageCancelled: new Set(["Standal|07:00:00"]) }), min("06:00"));
  assert.equal(message.kind, "cancelled");
  assert.equal(message.source, "messages");
  assert.equal(departureStateKey(message, { today: true }), "cancelled");
});

test("tripStatus: open før fristen", () => {
  const status = tripStatus(out, evidence(), min("12:30"));
  assert.equal(status.kind, "open");
  assert.equal(status.deadline, min("13:00"));
  assert.equal(status.reason, "before-deadline");
  assert.equal(departureStateKey(status, { today: true }), "countdown");
});

test("tripStatus: ukjent etter fristen utan bevis, og «Ukjent» i staden for «Gått» etter avgang", () => {
  const before = tripStatus(out, evidence(), min("13:30"));
  assert.equal(before.kind, "unknown");
  assert.equal(before.source, null);
  assert.equal(departureStateKey(before, { today: true }), "countdown");
  const after = tripStatus(out, evidence(), min("14:30"));
  assert.equal(after.kind, "unknown");
  assert.equal(departureStateKey(after, { today: true, departed: true }), "unknown");
  assert.equal(departureStateKey(after, { today: true, past: true }), "unknown");
});

test("tripStatus: bevist gått frå signalloggen", () => {
  const ev = evidence({ log: logged([{ id: J(1), status: "gått", evidence: "departed", observedAt: "2026-10-08T14:20:00+02:00" }]) });
  const status = tripStatus(out, ev, min("14:30"));
  assert.equal(status.kind, "sailed");
  assert.equal(status.source, "log");
  assert.equal(status.at, "2026-10-08T14:20:00+02:00");
  assert.equal(departureStateKey(status, { today: true, departed: true }), "gone");
});

test("tripStatus: bevist gått i sanntid slår avlysing hos Entur", () => {
  const ev = evidence({ cancelledJourneys: new Set([J(1)]), sailedJourneys: new Set([J(1)]) });
  const status = tripStatus(out, ev, min("14:30"));
  assert.equal(status.kind, "sailed");
  assert.equal(status.source, "live");
  assert.equal(status.verdict, null);
});

test("tripStatus: bestilt når Entur har faktisk avgang, og appen blir beden om å hugse det", () => {
  const ev = evidence({ actualDepartures: new Map([[J(1), "2026-10-08T14:01:00+02:00"]]) });
  const status = tripStatus(out, ev, min("14:05"));
  assert.equal(status.kind, "booked");
  assert.equal(status.source, "entur");
  assert.equal(status.at, "2026-10-08T14:01:00+02:00");
  assert.deepEqual(status.remember, { id: J(1), booked: true });
});

test("tripStatus: bestilt frå loggen med avgangsbevis, òg ein tidlegare dag", () => {
  const entry = { id: J(1), status: "booked", evidence: "departed", observedAt: "2026-10-07T14:02:00+02:00" };
  const ev = evidence({ date: "2026-10-07", log: logged([entry], "2026-10-07") });
  const status = tripStatus(out, ev, min("20:00"));
  assert.equal(status.kind, "booked");
  assert.equal(status.source, "log");
  assert.equal(departureStateKey(status, { today: false }), "gone");
  // «booked» utan avgangsbevis er eit gammalt gjett og tel ikkje.
  const guess = evidence({ date: "2026-10-07", log: logged([{ ...entry, evidence: undefined }], "2026-10-07") });
  assert.equal(tripStatus(out, guess, min("20:00")).kind, "unknown");
});

test("tripStatus: bestilt fordi ferja har lagt frå kai i fersk sanntid", () => {
  const ev = evidence({ live: liveAt("Trandal", false, { actualDeparture: "2026-10-08T12:01:00Z" }) });
  const status = tripStatus(out, ev, min("14:05"));
  assert.equal(status.kind, "booked");
  assert.equal(status.source, "live");
  assert.equal(status.verdict, "running");
});

test("tripStatus: hugsar bestilt frå tidlegare i dag når beviset er borte", () => {
  const status = tripStatus(out, evidence({ confirmedBooked: new Set([J(1)]) }), min("14:30"));
  assert.equal(status.kind, "booked");
  assert.equal(status.source, "memory");
  assert.equal(status.remember, null);
});

test("tripStatus: utturen er tomtur for ein retur som gjekk, så han er ikkje bestilt", () => {
  const out2 = leg("Standal", "Trandal", "17:30:00", "17:45:00", 4);
  const legs = [out2, back];
  const ev = evidence({
    dayLegs: legs,
    dateLegs: legs,
    actualDepartures: new Map([[J(4), "2026-10-08T17:31:00+02:00"], [J(2), "2026-10-08T18:00:00+02:00"]]),
    confirmedBooked: new Set([J(4)]),
  });
  const status = tripStatus(out2, ev, min("18:30"));
  assert.equal(status.booked, false);
  assert.deepEqual(status.remember, { id: J(4), booked: false });
});

test("tripStatus: tomtur med avgangsbevis er «gått», ikkje «ukjent»", () => {
  const out2 = leg("Standal", "Trandal", "17:30:00", "17:45:00", 4);
  const legs = [out2, back];
  const returned = [J(2), "2026-10-08T18:00:00+02:00"];
  const base = { dayLegs: legs, dateLegs: legs };
  const at = min("18:30");
  const ctx = { past: true, departed: true, today: true };
  // Entur: faktisk avgang for utturen.
  const entur = tripStatus(
    out2,
    evidence({ ...base, actualDepartures: new Map([[J(4), "2026-10-08T17:31:00+02:00"], returned]) }),
    at
  );
  assert.equal(entur.booked, false);
  assert.equal(entur.kind, "sailed");
  assert.equal(entur.sailed, true);
  assert.equal(entur.source, "entur");
  assert.equal(entur.at, "2026-10-08T17:31:00+02:00");
  assert.equal(departureStateKey(entur, ctx), "gone");
  // Loggen: «departed» på utturen.
  const fromLog = tripStatus(
    out2,
    evidence({
      ...base,
      actualDepartures: new Map([returned]),
      log: logged([{ id: J(4), status: "booked", evidence: "departed", observedAt: "2026-10-08T15:31:00Z" }]),
    }),
    at
  );
  assert.equal(fromLog.booked, false);
  assert.equal(fromLog.kind, "sailed");
  assert.equal(fromLog.source, "log");
  assert.equal(departureStateKey(fromLog, ctx), "gone");
  // Sanntid: ferja køyrde utturen (hugsa frå sanntida tidlegare i dag).
  const live = tripStatus(
    out2,
    evidence({ ...base, actualDepartures: new Map([returned]), sailedJourneys: new Set([J(4)]) }),
    at
  );
  assert.equal(live.booked, false);
  assert.equal(live.kind, "sailed");
  assert.equal(live.source, "live");
  assert.equal(departureStateKey(live, ctx), "gone");
  // Utan bevis for sjølve utturen er han framleis «ukjent».
  const none = tripStatus(out2, evidence({ ...base, actualDepartures: new Map([returned]) }), at);
  assert.equal(none.kind, "unknown");
  assert.equal(none.sailed, false);
  assert.equal(departureStateKey(none, ctx), "unknown");
});

test("tripStatus: avgang i dag gjer ikkje same tur «gått» ein annan dag", () => {
  const out2 = leg("Standal", "Trandal", "17:30:00", "17:45:00", 4);
  const legs = [out2, back];
  // Same rute-id gjekk i dag (Entur, sanntid), og returen gjekk òg.
  const todayProof = {
    dayLegs: legs,
    dateLegs: legs,
    actualDepartures: new Map([[J(4), "2026-10-08T17:31:00+02:00"], [J(2), "2026-10-08T18:00:00+02:00"]]),
    sailedJourneys: new Set([J(4), J(2)]),
    confirmedBooked: new Set([J(4)]),
  };
  for (const date of ["2026-10-09", "2026-10-07"]) {
    const status = tripStatus(out2, evidence({ ...todayProof, date }), min("18:30"));
    assert.notEqual(status.kind, "sailed", date);
    assert.equal(status.sailed, false, date);
    assert.equal(status.booked, false, date);
    assert.equal(status.remember, null, date);
    assert.notEqual(departureStateKey(status, { today: false }), "gone", date);
    // «departed» i loggen for sjølve datoen tel.
    const logged2 = tripStatus(
      out2,
      evidence({
        ...todayProof,
        date,
        log: logged([{ id: J(4), status: "gått", evidence: "departed", observedAt: `${date}T15:31:00Z` }], date),
      }),
      min("18:30")
    );
    assert.equal(logged2.kind, "sailed", date);
    assert.equal(logged2.source, "log", date);
    assert.equal(logged2.sailed, true, date);
  }
});

test("tripStatus: avlyst hos Entur er «ikkje utført»", () => {
  const status = tripStatus(out, evidence({ cancelledJourneys: new Set([J(1)]) }), min("13:30"));
  assert.equal(status.kind, "skipped");
  assert.equal(status.skipReason, "cancelled");
  assert.equal(status.source, "entur");
  assert.equal(status.seenSkip, true);
  assert.equal(departureStateKey(status, { today: true }), "notRunning");
});

test("tripStatus: avlysing slår avgangsbevis i loggen, men ikkje «gått»", () => {
  const booked = { id: J(1), status: "booked", evidence: "departed" };
  const ev = evidence({ cancelledJourneys: new Set([J(1)]), log: logged([booked]) });
  assert.equal(tripStatus(out, ev, min("14:30")).kind, "skipped");
  const gone = evidence({ cancelledJourneys: new Set([J(1)]), log: logged([{ ...booked, status: "gått" }]) });
  assert.equal(tripStatus(out, gone, min("14:30")).kind, "sailed");
});

test("tripStatus: logga avlyst ein tidlegare dag", () => {
  const entry = { id: J(1), status: "skipped", observedAt: "2026-10-07T13:07:00+02:00", skippedAt: "2026-10-07T13:01:00+02:00" };
  const ev = evidence({ date: "2026-10-07", log: logged([entry], "2026-10-07") });
  const status = tripStatus(out, ev, min("20:00"));
  assert.equal(status.kind, "skipped");
  assert.equal(status.source, "log");
  assert.equal(status.at, "2026-10-07T13:01:00+02:00");
  assert.equal(status.skippedAt, "2026-10-07T13:01:00+02:00");
});

test("tripStatus: bevist ikkje køyrd, ferja låg ved kai i fersk sanntid", () => {
  const ev = evidence({ live: liveAt("Standal", true) });
  const early = tripStatus(out, ev, min("14:10"));
  assert.equal(early.kind, "unknown", "innan slingringsmonnet kan ho berre vere forseinka");
  const status = tripStatus(out, ev, min("14:20"));
  assert.equal(status.kind, "skipped");
  assert.equal(status.skipReason, "live");
  assert.equal(status.source, "live");
  assert.equal(status.reason, "live-at-quay");
  assert.equal(status.at, "2026-10-08T12:30:00Z");
});

test("tripStatus: gammal sanntid er ikkje bevis", () => {
  const stale = { ...liveAt("Standal", true), validUntil: "2000-01-01T00:00:00Z", recordedAt: "2000-01-01T00:00:00Z" };
  assert.equal(tripStatus(out, evidence({ live: stale }), min("14:30")).kind, "unknown");
});

test("tripStatus: opts.live overstyrer berre slutninga om «ikkje utført»", () => {
  const ev = evidence({ live: liveAt("Standal", true) });
  assert.equal(tripStatus(out, ev, min("14:20"), { live: null }).kind, "unknown");
});

test("tripStatus endrar ikkje bevisa", () => {
  const ev = evidence({
    actualDepartures: new Map([[J(1), "2026-10-08T14:01:00+02:00"]]),
    confirmedBooked: new Set(),
  });
  tripStatus(out, ev, min("14:05"));
  assert.equal(ev.confirmedBooked.size, 0);
  assert.equal(ev.sailedJourneys.size, 0);
});

// Laurdag 10. okt: Entur koplar ferja til 12:15 Valderøya → Store Kalvøy medan ho ligg ved Standal (flyttar seg til
// Valderøya). Posisjonen er langt frå startkaien Valderøya, men ikkje på strekninga: turen er ikkje «gått».
const STANDAL = { latitude: 62.266468, longitude: 6.423213 };
const VALDEROYA = { latitude: 62.495872, longitude: 6.128569 };
const KALVOY = { latitude: 62.526923, longitude: 6.20374 };
const kalvoy = leg("Valderøya", "Store Kalvøy", "12:15:00", "12:35:00", 5);

test("tripStatus: Entur-posisjon ved Standal på 12:15 Valderøya → Store Kalvøy er ikkje «gått» (ferja er på veg til turen)", () => {
  const live = { validUntil: "2099-01-01T00:00:00Z", recordedAt: "2026-10-08T12:30:00Z", journeyRef: J(5), ...STANDAL };
  const legs = [kalvoy];
  for (const at of ["12:04", "12:14", "12:16", "12:20"]) {
    const status = tripStatus(kalvoy, evidence({ live, dayLegs: legs, dateLegs: legs, clockNow: min(at) }), min(at));
    assert.equal(status.kind, "unknown", at);
    assert.equal(status.sailed, false, at);
    assert.notEqual(departureStateKey(status, { today: true }), "gone", at);
  }
});

test("tripStatus: Entur-posisjon på strekninga eller ved startkaien: lagt frå kai berre når ho er på vegen", () => {
  const legs = [kalvoy];
  const mid = { latitude: (VALDEROYA.latitude + KALVOY.latitude) / 2, longitude: (VALDEROYA.longitude + KALVOY.longitude) / 2 };
  const base = { validUntil: "2099-01-01T00:00:00Z", recordedAt: "2026-10-08T12:30:00Z", journeyRef: J(5) };
  const underway = tripStatus(kalvoy, evidence({ live: { ...base, ...mid }, dayLegs: legs, dateLegs: legs, clockNow: min("12:20") }), min("12:20"));
  assert.notEqual(underway.kind, "unknown", "midt på strekninga: lagt frå kai");
  const atQuay = tripStatus(kalvoy, evidence({ live: { ...base, ...VALDEROYA }, dayLegs: legs, dateLegs: legs, clockNow: min("12:20") }), min("12:20"));
  assert.equal(atQuay.sailed, false, "ved startkaien: ikkje lagt frå");
  assert.equal(atQuay.kind, "unknown");
});

// Feilen 10. oktober 2026: 1136 låg ved Standal, Entur kopla ferja til signalturen 12:15 Valderøya → Store Kalvøy
// (1136_615) på førehand, og appen viste «Bestilt signaltur». AIS viste ferja ved Standal heile tida.
const VALDEROYA_TRIP = {
  id: "MOR:ServiceJourney:1136_615_9150000037358198#0",
  from: "Valderøya",
  to: "Store Kalvøy",
  departure: "12:15:00",
  arrival: "12:25:00",
  signal: { minutesBefore: 60, phone: "91 66 93 40" },
};
const STANDAL_FIX = { latitude: 62.2665, longitude: 6.4232 };

function standalEvidence(live, partial = {}) {
  return evidence({
    dayLegs: [VALDEROYA_TRIP],
    dateLegs: [VALDEROYA_TRIP],
    live: {
      validUntil: "2099-01-01T00:00:00Z",
      recordedAt: "2026-10-10T10:12:00Z",
      journeyRef: "MOR:ServiceJourney:1136_615_9150000037358198",
      stopName: "Standal",
      ...STANDAL_FIX,
      ...live,
    },
    clockNow: min("12:12"),
    ...partial,
  });
}

test("tripStatus: ferja ved Standal med turen Valderøya → Store Kalvøy tilordna er ikkje bestilt eller køyrd", () => {
  for (const live of [
    { atStop: true },
    { atStop: false },
    { atStop: null },
    { atStop: true, latitude: undefined, longitude: undefined },
    { atStop: true, actualDeparture: "2026-10-10T12:10:00+02:00" },
  ]) {
    for (const clock of ["12:12", "12:20", "12:40"]) {
      const ev = standalEvidence(live, { clockNow: min(clock) });
      const status = tripStatus(VALDEROYA_TRIP, ev, min(clock));
      assert.notEqual(status.kind, "booked", `${JSON.stringify(live)} ${clock}`);
      assert.notEqual(status.kind, "sailed", `${JSON.stringify(live)} ${clock}`);
    }
  }
});

test("liveProvesSailed og leftOrigin: ved ei anna kai enn start- og endekaia tel ikkje som avgang", () => {
  const atStandal = standalEvidence({ atStop: true }).live;
  assert.equal(leftOrigin(atStandal, VALDEROYA_TRIP), null);
  assert.equal(liveProvesSailed(atStandal, VALDEROYA_TRIP, min("12:20")), false);
  // Ekte avgang: på strekninga etter rutetida, eller ved endekaia.
  const underway = { ...atStandal, atStop: false, stopName: "Store Kalvøy", latitude: 62.51, longitude: 6.16 };
  assert.equal(leftOrigin(underway, VALDEROYA_TRIP), true);
  assert.equal(liveProvesSailed(underway, VALDEROYA_TRIP, min("12:20")), true);
  const arrived = { ...atStandal, stopName: "Store Kalvøy", atStop: true, latitude: 62.526923, longitude: 6.20374 };
  assert.equal(leftOrigin(arrived, VALDEROYA_TRIP), true);
});
