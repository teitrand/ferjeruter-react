import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDb } from "../src/db.js";

const DAY = 86400000;
const pos = (line, iso, extra = {}) => ({
  line,
  vehicleId: "MOR:Vehicle:1",
  source: "stream",
  observedAt: iso,
  recordedAt: iso,
  latitude: 62.26,
  longitude: 6.5,
  atStop: true,
  stopName: "Trandal",
  ...extra,
});

test("WAL på fil, duplikat blir ignorert", () => {
  const dir = mkdtempSync(join(tmpdir(), "fr-db-"));
  try {
    const db = openDb(join(dir, "c.sqlite"));
    assert.equal(db.raw.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
    assert.equal(db.insertPosition(pos("1136", "2026-10-09T09:00:00Z")), true);
    assert.equal(db.insertPosition(pos("1136", "2026-10-09T09:00:00Z")), false);
    assert.equal(db.insertPosition(pos("1136", "2026-10-09T09:00:10Z")), true);
    assert.equal(db.stats().positions, 2);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rader eldre enn 30 dagar blir sletta, 30 dagar og nyare blir verande", () => {
  const db = openDb(":memory:", { retentionDays: 30 });
  const now = Date.parse("2026-10-09T12:00:00Z");
  for (let d = 0; d < 40; d++) {
    const iso = new Date(now - d * DAY).toISOString();
    db.insertPosition(pos("1136", iso));
    db.insertEvent({ line: "1136", kind: "departed", serviceDate: iso.slice(0, 10), at: now - d * DAY, stop: "Trandal", slot: "10:00" });
  }
  const pruned = db.prune(now);
  assert.equal(pruned.positions, 9);
  assert.equal(pruned.events, 9);
  const stats = db.stats();
  assert.equal(stats.positions, 31);
  assert.equal(stats.events, 31);
  assert.equal(Date.parse(stats.oldest), now - 30 * DAY);
  assert.deepEqual(db.prune(now), { positions: 0, events: 0 });
});

test("hendingar er unike per dag, linje, slag, tur og kai", () => {
  const db = openDb(":memory:");
  const ev = { line: "1136", kind: "sailed", serviceDate: "2026-10-09", at: 1, journeyRef: "MOR:ServiceJourney:A", stop: "Trandal" };
  assert.equal(db.insertEvent(ev), true);
  assert.equal(db.insertEvent({ ...ev, at: 2 }), false);
  assert.equal(db.insertEvent({ ...ev, journeyRef: "MOR:ServiceJourney:B" }), true);
  assert.equal(db.eventsFor("2026-10-09", "1136").length, 2);
  assert.equal(db.eventsFor("2026-10-09", "1135").length, 0);
});

test("meta (siste kjende) overlever og les tilbake", () => {
  const db = openDb(":memory:");
  db.setMeta("lastKnown", { 1136: { recordedAt: "x" } });
  assert.deepEqual(db.getMeta("lastKnown"), { 1136: { recordedAt: "x" } });
  assert.equal(db.getMeta("finst-ikkje"), null);
});
