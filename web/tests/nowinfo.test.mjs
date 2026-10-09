// Teksten i «No»-raden (packages/core/nowinfo.js): kvar ferja er, neste/fyrste tur med nedteljing,
// overfartstid og turen etter. Reine funksjonar; alle tal kjem frå turane og klokka.
import assert from "node:assert/strict";
import { test } from "node:test";
import { appVersion } from "../../tests/helpers/version.mjs";
import { nowInfo } from "../../packages/core/index.js";

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
const info = (nowMs, { status, legs = DAY, running = legs, legsOn = () => DAY, event = ev(), today = "2026-10-09", atQuay = null } = {}) =>
  nowInfo({ status, legs, running, ev: event, nowMs, today, legsOn, atQuay });
const texts = (result) => result.lines.map((line) => `${line.kind}: ${line.text}`);
const done = { short: "Ferja er ferdig for dagen på Standal", text: "Ferja er ferdig for dagen på Standal." };

test("natt ved kai: fyrste tur i morgon, nedteljing, overfartstid og turen etter", () => {
  setLang("nn");
  const lines = texts(info(oslo(9, 21, 10), { status: done }));
  assert.deepEqual(lines, [
    "place: Ferja er ferdig for dagen på Standal",
    "next: Første tur i morgon 06:40 frå Standal, om 9 t 30 min",
    "trip: Overfarta tek 10 min, framme 06:50",
    "then: Deretter 07:00 frå Trandal",
  ]);
});

test("etter midnatt: dagen i dag har ikkje starta, så det er «fyrste tur i dag»", () => {
  setLang("nn");
  const lines = texts(info(oslo(9, 0, 30), { status: { short: "Ferja ligg til kai på Standal" } }));
  assert.equal(lines[1], "next: Første tur i dag 06:40 frå Standal, om 6 t 10 min");
});

test("dagtid ved kai mellom turar: neste avgang med nedteljing, overfartstid, turen etter", () => {
  setLang("nn");
  const legs = [leg("Standal", "Trandal", "12:00", "12:10"), leg("Trandal", "Standal", "12:30", "12:40"), leg("Standal", "Trandal", "13:00", "13:10")];
  const lines = texts(info(oslo(9, 12, 14), { status: { short: "Ferja ligg til kai på Trandal" }, legs }));
  assert.deepEqual(lines, [
    "place: Ferja ligg til kai på Trandal",
    "next: Neste avgang 12:30 frå Trandal, om 16 min",
    "trip: Overfarta tek 10 min, framme 12:40",
    "then: Deretter 13:00 frå Standal",
  ]);
  // Under eitt minutt att: «no», aldri «om 0 min».
  assert.equal(info(oslo(9, 12, 29, 40), { status: { short: "x" }, legs }).lines[1].text, "Neste avgang 12:30 frå Trandal, no");
});

test("på overfart: kvar ferja skal og turen etter ankomst; siste tur seier kva som kjem i morgon", () => {
  setLang("nn");
  const underway = { underway: true, text: "Ferja er på veg mot Standal" };
  assert.deepEqual(texts(info(oslo(9, 7, 4), { status: underway })), ["place: Ferja er på veg mot Standal", "then: Deretter 20:00 frå Standal"]);
  const last = texts(info(oslo(9, 20, 25), { status: underway }));
  assert.deepEqual(last, ["place: Ferja er på veg mot Standal", "then: Første tur i morgon 06:40 frå Standal"]);
});

test("avlyst avgang blir sagt som den er, og vi lovar ikkje den som ikkje går", () => {
  setLang("nn");
  const cancelled = new Set(["Standal|20:00:00"]);
  const event = ev({ messageCancelled: cancelled });
  const running = DAY.filter((item) => item.departure !== "20:00:00");
  const lines = texts(info(oslo(9, 19, 50), { status: { short: "Ferja ligg til kai på Standal" }, running, event }));
  assert.equal(lines[1], "cancelled: Avgangen 20:00 frå Standal er avlyst");
  assert.equal(lines[2], "next: Neste avgang 20:20 frå Trandal, om 30 min");
});

test("signaltur blir merkt «på signal», i fleire språk", () => {
  const legs = [leg("Standal", "Trandal", "22:00", "22:10", { signal: true })];
  setLang("nn");
  assert.equal(info(oslo(9, 21, 0), { status: { short: "x" }, legs }).lines[1].text, "Første tur i dag 22:00 frå Standal, om 1 t · på signal");
  setLang("en");
  assert.equal(info(oslo(9, 21, 0), { status: { short: "x" }, legs }).lines[1].text, "First sailing today 22:00 from Standal, in 1 h · on request");
  setLang("de");
  assert.equal(info(oslo(9, 21, 0), { status: { short: "x" }, legs }).lines[2].text, "Die Überfahrt dauert 10 Min., Ankunft 22:10");
  setLang("nn");
});

test("fleire språk: natt ved kai", () => {
  setLang("en");
  assert.deepEqual(texts(info(oslo(9, 21, 10), { status: { short: "The ferry has finished for the day at Standal" } })).slice(1), [
    "next: First sailing tomorrow 06:40 from Standal, in 9 h 30 min",
    "trip: The crossing takes 10 min, arriving 06:50",
    "then: After that 07:00 from Trandal",
  ]);
  setLang("de");
  assert.deepEqual(texts(info(oslo(9, 21, 10), { status: { short: "x" } })).slice(1), [
    "next: Erste Fahrt morgen 06:40 ab Standal, in 9 Std. 30 Min.",
    "trip: Die Überfahrt dauert 10 Min., Ankunft 06:50",
    "then: Danach 07:00 ab Trandal",
  ]);
  setLang("nn");
});

test("ingen tur i morgon: neste driftsdag med dagnamn, utan nedteljing når det er over 36 timar fram", () => {
  setLang("nn");
  const legsOn = (iso) => (iso === "2026-10-12" ? DAY : []);
  const lines = info(oslo(9, 21, 0), { status: done, legsOn }).lines;
  assert.equal(lines[1].text, "Første tur måndag 12. oktober kl. 06:40 frå Standal", "57 timar fram: ingen nedteljing");
  const near = info(oslo(10, 21, 0), { status: done, legsOn, today: "2026-10-10" }).lines;
  assert.equal(near[1].text, "Første tur måndag 12. oktober kl. 06:40 frå Standal, om 33 t 40 min");
  const sooner = info(oslo(11, 21, 0), { status: done, legsOn, today: "2026-10-11" }).lines;
  assert.equal(sooner[1].text, "Første tur i morgon 06:40 frå Standal, om 9 t 40 min");
  // Ingen tur den neste veka: berre statuslinja, ingenting funne på.
  assert.deepEqual(texts(info(oslo(9, 21, 0), { status: done, legsOn: () => [] })), ["place: Ferja er ferdig for dagen på Standal"]);
});

test("overgangen til vintertid: nedteljinga følgjer faktisk tid, ikkje veggklokka", () => {
  setLang("nn");
  // Lørdag 24. okt kl. 21:00 (CEST). Natt til søndag 25. okt går klokka tilbake, så 06:40 er 10 t 40 min fram.
  const lines = info(oslo(24, 21, 0), { status: done, today: "2026-10-24" }).lines;
  assert.equal(lines[1].text, "Første tur i morgon 06:40 frå Standal, om 10 t 40 min");
});

test("tabellen seier overfart, men AIS viser ferja ved kai: planlagd avgang, ikkje «på veg»", () => {
  setLang("nn");
  const atQuay = { short: "Ferja ligg til kai på Standal", text: "Ferja ligg til kai på Standal.", position: "ais" };
  const lines = texts(info(oslo(9, 20, 4), { status: atQuay }));
  assert.deepEqual(lines.slice(0, 3), ["place: Ferja ligg til kai på Standal", "next: Planlagd avgang 20:00 frå Standal", "trip: Overfarta tek 10 min, framme 20:10"]);
});

test("utan status eller turar blir det ikkje funne på tekst", () => {
  assert.deepEqual(info(oslo(9, 12, 0), { status: null, legs: [], running: [], legsOn: () => [] }).lines, []);
});

test("fersk AIS ved kai om natta: «ligg til kai på X» frå AIS, og fyrste tur i morgon under", () => {
  setLang("nn");
  const lines = texts(info(oslo(9, 21, 10), { status: done, atQuay: "Standal" }));
  assert.equal(lines[0], "place: Ferja ligg til kai på Standal");
  assert.equal(lines[1], "next: Første tur i morgon 06:40 frå Standal, om 9 t 30 min");
  // AIS ved ei anna kai enn rutetabellen sa: AIS vinn.
  assert.equal(info(oslo(9, 21, 10), { status: done, atQuay: "Trandal" }).lines[0].text, "Ferja ligg til kai på Trandal");
  // På overfart etter tabellen og ikkje overstyrt: AIS-kaia blir ikkje brukt.
  assert.equal(info(oslo(9, 20, 5), { status: { underway: true, text: "Ferja er på veg mot Standal" }, atQuay: "Standal" }).lines[0].text, "Ferja er på veg mot Standal");
});
