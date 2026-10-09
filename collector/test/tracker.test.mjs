import assert from "node:assert/strict";
import test from "node:test";
import { createTracker, evidenceFromEvents } from "../src/tracker.js";

// 12:00 i Oslo. validUntil langt fram, så isLiveFresh i core seier fersk.
const base = Date.parse("2026-10-09T10:00:00Z");
const FAR = "2099-01-01T00:00:00Z";
const leg = { id: "MOR:ServiceJourney:1136_1_A", departure: "11:55:00", arrival: "12:10:00", from: "Trandal", to: "Sæbø", signal: true };

const at = (min, place) => ({
  line: "1136",
  vehicleId: "MOR:Vehicle:1",
  source: "stream",
  observedAt: new Date(base + min * 60000).toISOString(),
  recordedAt: new Date(base + min * 60000).toISOString(),
  validUntil: FAR,
  journeyRef: "MOR:ServiceJourney:1136_1_A",
  ...place,
});
const TRANDAL = { latitude: 62.260997, longitude: 6.500688, stopName: "Trandal", atStop: true };
const OPEN_SEA = { latitude: 62.24, longitude: 6.49, stopName: "", atStop: false };
const SAEBO = { latitude: 62.210998, longitude: 6.475821, stopName: "Sæbø", atStop: true };

test("avgang, køyrd tur og framkomst frå posisjonar (dobbel «sailed» blir slått saman i databasen)", () => {
  let clock = base;
  const tracker = createTracker({ legsFor: () => [leg], now: () => clock });
  const kinds = [];
  for (const [min, place] of [[-10, TRANDAL], [-6, TRANDAL], [1, OPEN_SEA], [12, SAEBO]]) {
    clock = base + min * 60000 + 5000;
    for (const ev of tracker.observe(at(min, place))) kinds.push(`${ev.kind}:${ev.stop || ""}`);
  }
  assert.deepEqual(kinds, ["departed:Trandal", "sailed:Trandal", "arrived:Sæbø", "sailed:Trandal"]);
  assert.equal(tracker.lastKnown["1136"].stopName, "Sæbø");
});

test("ved kai før avgangstida er ikkje bevis for køyrd tur", () => {
  const tracker = createTracker({ legsFor: () => [leg], now: () => base - 9 * 60000 });
  assert.deepEqual(tracker.observe(at(-10, TRANDAL)), []);
});

test("gammal posisjon (ikkje fersk) gjev ikkje «sailed», men blir siste kjende", () => {
  const tracker = createTracker({ legsFor: () => [leg], now: () => base + 3600000 });
  const old = { ...at(1, OPEN_SEA), validUntil: new Date(base + 2 * 60000).toISOString() };
  assert.deepEqual(tracker.observe(old), []);
  assert.equal(tracker.lastKnown["1136"], old);
});

test("eldre melding overskriv ikkje nyare siste kjende; CANCELLED blir hending", () => {
  const tracker = createTracker({ now: () => base });
  const newer = at(5, OPEN_SEA);
  tracker.observe(newer);
  const evs = tracker.observe({ ...at(1, OPEN_SEA), vehicleStatus: "CANCELLED" });
  assert.equal(tracker.lastKnown["1136"], newer);
  assert.deepEqual(evs.map((e) => e.kind), ["cancelled"]);
  tracker.restore({ 1135: { line: "1135" }, 1136: { line: "x" } });
  assert.equal(tracker.lastKnown["1136"], newer);
  assert.equal(tracker.lastKnown["1135"].line, "1135");
});

test("bevis per linje frå lagra hendingar", () => {
  const ev = evidenceFromEvents([
    { line: "1136", kind: "sailed", journey_ref: "A", at: base },
    { line: "1136", kind: "sailed", journey_ref: "A", at: base },
    { line: "1136", kind: "departed", stop: "Trandal", journey_ref: "A", at: base },
    { line: "1135", kind: "cancelled", journey_ref: "B", at: base },
  ]);
  assert.deepEqual(ev["1136"].sailed, ["A"]);
  assert.equal(ev["1136"].departures[0].stop, "Trandal");
  assert.deepEqual(ev["1135"].cancelled, ["B"]);
});
