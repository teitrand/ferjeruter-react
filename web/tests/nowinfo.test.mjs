// Teksten i «No»-raden (packages/core/nowinfo.js): kvar ferja er, og berre det som ikkje alt står i statuslinja eller på
// avgangsrada: avlysing, forseinka tur, overfartstid. Første tur når dagen er slutt (`first`) går til statuslinja.
// Reine funksjonar; alle tal kjem frå turane og klokka.
import assert from "node:assert/strict";
import { test } from "node:test";
import { appVersion } from "../../tests/helpers/version.mjs";
import { nowInfo, onRequestTag, pickNextDeparture } from "../../packages/core/index.js";

const { setLang } = await import(`../../assets/i18n.js?v=${appVersion()}`);

/** Oslo-veggtid (CEST, UTC+2) som epoke-ms. */
const oslo = (day, h, m, s = 0) => Date.UTC(2026, 9, day, h - 2, m, s);
const leg = (from, to, departure, arrival, extra = {}) => ({ id: `${from}-${departure}`, from, to, departure: `${departure}:00`, arrival: `${arrival}:00`, ...extra });
const DAY = [
  leg("Standal", "Trandal", "06:40", "06:50"),
  leg("Trandal", "Standal", "07:00", "07:10"),
  leg("Standal", "Trandal", "20:00", "20:10"),
  leg("Trandal", "Standal", "20:20", "20:30"),
];
const ev = (extra = {}) => ({ date: "2026-10-09", today: "2026-10-09", cancelledJourneys: new Set(), messageCancelled: new Set(), ...extra });
const info = (nowMs, { status, legs = DAY, running = legs, legsOn = () => DAY, event = ev(), today = "2026-10-09", atQuay = null, arrivalShown = false } = {}) =>
  nowInfo({ status: atQuay && status ? { ...status, atQuay } : status, legs, running, ev: event, nowMs, today, legsOn, arrivalShown });
const texts = (result) => result.lines.map((line) => `${line.kind}: ${line.text}`);
const done = { short: "Ferja er ferdig for dagen på Standal", text: "Ferja er ferdig for dagen på Standal." };

test("natt ved kai: «No» seier kvar ferja er og overfartstida; første tur i morgon går til statuslinja", () => {
  setLang("nn");
  const result = info(oslo(9, 21, 10), { status: done });
  assert.deepEqual(texts(result), ["place: Ferja er ferdig for dagen på Standal", "trip: Overfarta tek 10 min, framme 06:50"]);
  assert.equal(result.first, "Første tur i morgon 06:40 frå Standal, om 9 t 30 min");
  // Ingen «Deretter»-linje og ingen gjentaking av neste avgang i «No».
  assert.ok(!result.lines.some((line) => line.kind === "next" || line.kind === "then"));
});

test("etter midnatt: dagen i dag har ikkje starta, så det er «fyrste tur i dag» i statuslinja (ikkje i «No»)", () => {
  setLang("nn");
  const result = info(oslo(9, 0, 30), { status: { short: "Ferja ligg til kai på Standal" } });
  assert.deepEqual(texts(result), ["place: Ferja ligg til kai på Standal", "trip: Overfarta tek 10 min, framme 06:50"]);
  assert.equal(result.first, null, "turane i dag står i tidslinja, og «Neste avgang» står i statuslinja");
  assert.deepEqual(texts(info(oslo(9, 0, 30), { status: { short: "Ferja ligg til kai på Standal" }, arrivalShown: true })), ["place: Ferja ligg til kai på Standal"]);
});

test("dagtid ved kai mellom turar: berre staden, og overfartstid når ankomst ikkje står på avgangsrada", () => {
  setLang("nn");
  const legs = [leg("Standal", "Trandal", "12:00", "12:10"), leg("Trandal", "Standal", "12:30", "12:40"), leg("Standal", "Trandal", "13:00", "13:10")];
  assert.deepEqual(texts(info(oslo(9, 12, 14), { status: { short: "Ferja ligg til kai på Trandal" }, legs })), [
    "place: Ferja ligg til kai på Trandal",
    "trip: Overfarta tek 10 min, framme 12:40",
  ]);
  // Ankomsttida står på avgangsrada (ankomstar på, ingen filter): ingenting å gjenta.
  assert.deepEqual(texts(info(oslo(9, 12, 14), { status: { short: "Ferja ligg til kai på Trandal" }, legs, arrivalShown: true })), [
    "place: Ferja ligg til kai på Trandal",
  ]);
});

test("på overfart: berre kvar ferja skal (framdrift og minutt att står i overfartslinja)", () => {
  setLang("nn");
  const underway = { underway: true, text: "Ferja er på veg mot Standal" };
  assert.deepEqual(texts(info(oslo(9, 7, 4), { status: underway })), ["place: Ferja er på veg mot Standal"]);
  assert.deepEqual(texts(info(oslo(9, 20, 25), { status: underway })), ["place: Ferja er på veg mot Standal"]);
});

test("avlyst avgang blir sagt som den er, og vi lovar ikkje den som ikkje går", () => {
  setLang("nn");
  const cancelled = new Set(["Standal|20:00:00"]);
  const event = ev({ messageCancelled: cancelled });
  const running = DAY.filter((item) => item.departure !== "20:00:00");
  const lines = texts(info(oslo(9, 19, 50), { status: { short: "Ferja ligg til kai på Standal" }, running, event, arrivalShown: true }));
  assert.deepEqual(lines, ["place: Ferja ligg til kai på Standal", "cancelled: Avgangen 20:00 frå Standal er avlyst"]);
});

test("onRequestTag: signalmerke med frist, «fristen er ute» og «bestilt», i fleire språk", () => {
  const sig = { ...leg("Standal", "Trandal", "22:00", "22:10"), signal: { minutesBefore: 60 } };
  setLang("nn");
  assert.equal(onRequestTag(sig), "på signal, ring innan 21:00");
  assert.equal(onRequestTag(sig, { booked: true }), "på signal, bestilt");
  assert.equal(onRequestTag({ ...sig, signal: true }), "på signal");
  assert.equal(onRequestTag(leg("Standal", "Trandal", "22:00", "22:10")), "", "ikkje signaltur: ingen merke");
  setLang("en");
  assert.equal(onRequestTag(sig), "on request, call by 21:00");
  setLang("de");
  assert.equal(onRequestTag(sig), "auf Anfrage, anrufen bis 21:00");
  setLang("nn");
});

test("første tur om natta er ein signaltur: merket står i setninga, med frist", () => {
  const legs = [{ ...leg("Standal", "Trandal", "22:00", "22:10"), signal: { minutesBefore: 60 } }];
  setLang("nn");
  assert.equal(info(oslo(9, 23, 30), { status: { short: "x" }, legs: [], running: [], legsOn: () => legs }).first, "Første tur i morgon 22:00 frå Standal, om 22 t 30 min · på signal, ring innan 21:00");
  setLang("en");
  assert.equal(info(oslo(9, 23, 30), { status: { short: "x" }, legs: [], running: [], legsOn: () => legs }).first, "First sailing tomorrow 22:00 from Standal, in 22 h 30 min · on request, call by 21:00");
  setLang("nn");
});

test("fleire språk: natt ved kai", () => {
  setLang("en");
  let result = info(oslo(9, 21, 10), { status: { short: "The ferry is at Standal" } });
  assert.deepEqual(texts(result).slice(1), ["trip: The crossing takes 10 min, arriving 06:50"]);
  assert.equal(result.first, "First sailing tomorrow 06:40 from Standal, in 9 h 30 min");
  setLang("de");
  result = info(oslo(9, 21, 10), { status: { short: "x" } });
  assert.deepEqual(texts(result).slice(1), ["trip: Die Überfahrt dauert 10 Min., Ankunft 06:50"]);
  assert.equal(result.first, "Erste Fahrt morgen 06:40 ab Standal, in 9 Std. 30 Min.");
  setLang("nn");
});

test("ingen tur i morgon: neste driftsdag med dagnamn, utan nedteljing når det er over 36 timar fram", () => {
  setLang("nn");
  const legsOn = (iso) => (iso === "2026-10-12" ? DAY : []);
  assert.equal(info(oslo(9, 21, 0), { status: done, legsOn }).first, "Første tur måndag 12. oktober kl. 06:40 frå Standal", "57 timar fram: ingen nedteljing");
  assert.equal(info(oslo(10, 21, 0), { status: done, legsOn, today: "2026-10-10" }).first, "Første tur måndag 12. oktober kl. 06:40 frå Standal, om 33 t 40 min");
  assert.equal(info(oslo(11, 21, 0), { status: done, legsOn, today: "2026-10-11" }).first, "Første tur i morgon 06:40 frå Standal, om 9 t 40 min");
  // Ingen tur den neste veka: berre statuslinja, ingenting funne på.
  const none = info(oslo(9, 21, 0), { status: done, legsOn: () => [] });
  assert.deepEqual(texts(none), ["place: Ferja er ferdig for dagen på Standal"]);
  assert.equal(none.first, null);
});

test("overgangen til vintertid: nedteljinga følgjer faktisk tid, ikkje veggklokka", () => {
  setLang("nn");
  // Lørdag 24. okt kl. 21:00 (CEST). Natt til søndag 25. okt går klokka tilbake, så 06:40 er 10 t 40 min fram.
  assert.equal(info(oslo(24, 21, 0), { status: done, today: "2026-10-24" }).first, "Første tur i morgon 06:40 frå Standal, om 10 t 40 min");
});

test("tabellen seier overfart, men AIS viser ferja ved kai: planlagd avgang, ikkje «på veg»", () => {
  setLang("nn");
  const atQuay = { short: "Ferja ligg til kai på Standal", text: "Ferja ligg til kai på Standal.", position: "ais" };
  assert.deepEqual(texts(info(oslo(9, 20, 4), { status: atQuay })), [
    "place: Ferja ligg til kai på Standal",
    "scheduled: Planlagd avgang 20:00 frå Standal",
    "trip: Overfarta tek 10 min, framme 20:10",
  ]);
});

test("utan status eller turar blir det ikkje funne på tekst", () => {
  assert.deepEqual(info(oslo(9, 12, 0), { status: null, legs: [], running: [], legsOn: () => [] }).lines, []);
});

test("fersk AIS ved kai om natta: «ligg til kai på X» frå AIS, og første tur i morgon i statuslinja", () => {
  setLang("nn");
  const result = info(oslo(9, 21, 10), { status: done, atQuay: "Standal" });
  assert.equal(result.lines[0].text, "Ferja ligg til kai på Standal");
  assert.equal(result.first, "Første tur i morgon 06:40 frå Standal, om 9 t 30 min");
  // AIS ved ei anna kai enn rutetabellen sa: AIS vinn.
  assert.equal(info(oslo(9, 21, 10), { status: done, atQuay: "Trandal" }).lines[0].text, "Ferja ligg til kai på Trandal");
  // På overfart etter tabellen og ikkje overstyrt: AIS-kaia blir ikkje brukt.
  assert.equal(info(oslo(9, 20, 5), { status: { underway: true, text: "Ferja er på veg mot Standal" }, atQuay: "Standal" }).lines[0].text, "Ferja er på veg mot Standal");
});

// --- «Neste avgang» er den ferja faktisk kan ta frå der ho er ---

const sig = (from, to, departure, arrival, minutesBefore) => leg(from, to, departure, arrival, { signal: { minutesBefore } });
// Laurdag: ferja ligg ved Standal-kaia (AIS); tabellen har to signalturar frå Valderøya og så 16:05 frå Standal.
const SAT = [
  leg("Trandal", "Standal", "09:45", "10:00"),
  sig("Valderøya", "Store Kalvøy", "12:15", "12:35", 180),
  sig("Store Kalvøy", "Valderøya", "13:15", "13:35", 180),
  leg("Standal", "Trandal", "16:05", "16:20"),
  leg("Trandal", "Standal", "16:25", "16:45"),
];
const minutes = (h, m) => h * 60 + m;
/** Fullt bevis som appen byggjer det (statusEvidence), men utan sanntid, logg og avlysingar. */
const fullEv = (legs, extra = {}) => ({
  date: "2026-10-10", today: "2026-10-10", live: null, log: undefined, cancelledJourneys: new Set(), actualDepartures: new Map(),
  confirmedBooked: new Set(), sailedJourneys: new Set(), messageCancelled: new Set(), clockNow: 0, dayLegs: legs, dateLegs: legs, ...extra,
});

test("ferja ved Standal, signalturane frå Valderøya har utgått frist: neste avgang er 16:05 frå Standal", () => {
  setLang("nn");
  const upcoming = SAT.slice(1);
  const next = pickNextDeparture(upcoming, fullEv(SAT), minutes(10, 20));
  assert.equal(next.id, "Standal-16:05");
  // Statuslinja og «No» ser same tur: overfartstida for 16:05 (ikkje 12:15), når ankomst ikkje står på avgangsrada.
  const status = { short: "Ferja ligg til kai på Standal", atQuay: "Standal" };
  const result = info(oslo(10, 10, 20), { status, legs: SAT, running: SAT, today: "2026-10-10", event: fullEv(SAT) });
  assert.deepEqual(texts(result), ["place: Ferja ligg til kai på Standal", "trip: Overfarta tek 15 min, framme 16:20"]);
});

test("signalturen er framleis open (før fristen): han er neste avgang, med frist; ferja flyttar seg etter tabellen", () => {
  setLang("nn");
  const next = pickNextDeparture(SAT.slice(1), fullEv(SAT), minutes(8, 0));
  assert.equal(next.id, "Valderøya-12:15");
  assert.equal(onRequestTag(next, { today: true, now: minutes(8, 0) }), "på signal, ring innan 09:15");
  // Fristen for 12:15 går ut kl. 09:15: då er 13:15 (frist 10:15) neste, og først etter 10:15 er det 16:05 frå Standal.
  assert.equal(pickNextDeparture(SAT.slice(1), fullEv(SAT), minutes(9, 16)).id, "Store Kalvøy-13:15");
  assert.equal(pickNextDeparture(SAT.slice(1), fullEv(SAT), minutes(10, 16)).id, "Standal-16:05");
  assert.equal(onRequestTag(SAT[1], { today: true, now: minutes(9, 16) }), "på signal, fristen er ute");
});

test("bestilt signaltur er neste avgang, òg etter fristen", () => {
  // Bevis (sett bestilt tidlegare i dag): turen er ikkje «unknown» og blir stå.
  const booked = { ...SAT[1], id: "MOR:ServiceJourney:1136_1" };
  const evWith = fullEv([booked, SAT[3]], { confirmedBooked: new Set(["MOR:ServiceJourney:1136_1"]) });
  assert.equal(pickNextDeparture([booked, SAT[3]], evWith, minutes(10, 20)).id, booked.id);
});

test("berre utgåtte signalturar att i dag: han står (med «fristen er ute»), vi seier ikkje «første tur i morgon»", () => {
  setLang("nn");
  const only = [sig("Standal", "Trandal", "20:00", "20:20", 60)];
  const next = pickNextDeparture(only, fullEv(only), minutes(19, 30));
  assert.equal(next.id, "Standal-20:00");
  assert.equal(onRequestTag(next, { today: true, now: minutes(19, 30) }), "på signal, fristen er ute");
  const result = info(oslo(10, 19, 30), { status: { short: "x" }, legs: only, running: only, today: "2026-10-10", event: fullEv(only) });
  assert.equal(result.first, null);
});

test("forseinka avgang frå kaia ferja ligg ved: «Planlagd avgang» med tida ho skulle gått", () => {
  setLang("nn");
  const day = [sig("Standal", "Trandal", "20:00", "20:20", 60)];
  const atQuay = { short: "Ferja ligg til kai på Standal", atQuay: "Standal" };
  const result = info(oslo(10, 20, 6), { status: atQuay, legs: day, running: day, today: "2026-10-10", event: fullEv(day) });
  assert.deepEqual(texts(result), ["place: Ferja ligg til kai på Standal", "scheduled: Planlagd avgang 20:00 frå Standal", "trip: Overfarta tek 20 min, framme 20:20"]);
});

test("AIS ved ei anna kai enn turen startar frå: ingen «Planlagd avgang» frå ei kai ferja ikkje ligg ved", () => {
  setLang("nn");
  const day = [sig("Valderøya", "Store Kalvøy", "12:15", "12:35", 180), leg("Standal", "Trandal", "16:05", "16:20")];
  const atStandal = { short: "Ferja ligg til kai på Standal", atQuay: "Standal" };
  const result = info(oslo(10, 12, 20), { status: atStandal, legs: day, running: day, today: "2026-10-10", event: fullEv(day) });
  assert.deepEqual(texts(result), ["place: Ferja ligg til kai på Standal", "trip: Overfarta tek 15 min, framme 16:20"]);
  // Same kai som turen startar frå: «Planlagd avgang» står som før.
  const atValderoya = { short: "Ferja ligg til kai på Valderøya", atQuay: "Valderøya" };
  assert.equal(texts(info(oslo(10, 12, 20), { status: atValderoya, legs: day, running: day, today: "2026-10-10", event: fullEv(day) }))[1], "scheduled: Planlagd avgang 12:15 frå Valderøya");
});

test("«No»-kortet får turen det viser planen for: neste tur, forseinka tur eller første tur neste driftsdag", () => {
  setLang("nn");
  const legs = [leg("Standal", "Trandal", "12:00", "12:10"), leg("Trandal", "Standal", "12:30", "12:40"), leg("Standal", "Trandal", "13:00", "13:10")];
  const upcoming = info(oslo(9, 12, 14), { status: { short: "Ferja ligg til kai på Trandal" }, legs });
  assert.equal(upcoming.legKind, "upcoming");
  assert.equal(upcoming.leg.departure, "12:30:00");
  // Tabellen seier overfart, men AIS seier ferja ligg ved starkaia: forseinka tur.
  const late = info(oslo(9, 12, 33), { status: { short: "Ferja ligg til kai på Trandal" }, legs, atQuay: "Trandal" });
  assert.equal(late.legKind, "scheduled");
  assert.equal(late.leg.departure, "12:30:00");
  // Dagen er slutt: første tur neste driftsdag, med kor mange dagar fram.
  const night = info(oslo(9, 21, 10), { status: done });
  assert.deepEqual([night.legKind, night.legAhead, night.legDay, night.leg.departure], ["first", 1, "2026-10-10", "06:40:00"]);
  // På overfart og utanfor ruta: ingen plan å vise.
  assert.deepEqual([info(oslo(9, 20, 25), { status: { underway: true, text: "Ferja er på veg mot Standal" } }).leg, info(oslo(9, 12, 14), { status: { outside: true, short: "Ferja er utanfor ruta" } }).leg], [null, null]);
});
