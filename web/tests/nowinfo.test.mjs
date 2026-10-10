// Teksten i «No»-raden (packages/core/nowinfo.js): kvar ferja er, og berre det som ikkje alt står i statuslinja eller på
// avgangsrada: avlysing, forseinka tur, overfartstid. Første tur når dagen er slutt (`first`) går til statuslinja.
// Reine funksjonar; alle tal kjem frå turane og klokka.
import assert from "node:assert/strict";
import { test } from "node:test";
import { appVersion } from "../../tests/helpers/version.mjs";
import { nowInfo, onRequestTag } from "../../packages/core/index.js";

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
