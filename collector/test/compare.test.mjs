import assert from "node:assert/strict";
import test from "node:test";
import { compareDay, reportMarkdown } from "../src/compare.js";
import { openDb } from "../src/db.js";

const date = "2026-10-08";
const legs = [
  { id: "MOR:ServiceJourney:1136_1_A", departure: "07:05:00", arrival: "07:20:00", from: "Trandal", to: "Standal", signal: true },
  { id: "MOR:ServiceJourney:1136_2_B", departure: "09:05:00", arrival: "09:20:00", from: "Trandal", to: "Standal", signal: true },
  { id: "MOR:ServiceJourney:1136_3_C", departure: "10:00:00", arrival: "10:15:00", from: "Standal", to: "Trandal", signal: false },
];
const signalLog = {
  days: {
    [date]: [
      { id: legs[0].id, from: "Trandal", to: "Standal", departure: "07:05:00", status: "booked", evidence: "departed" },
      { id: legs[1].id, from: "Trandal", to: "Standal", departure: "09:05:00", status: "booked", evidence: "departed" },
    ],
  },
};

test("innsamlar mot app og signallogg: samde og usamde signalturar", () => {
  const db = openDb(":memory:");
  db.insertPosition({ line: "1136", source: "stream", observedAt: `${date}T05:06:00Z`, recordedAt: `${date}T05:06:00Z` });
  db.insertEvent({ line: "1136", kind: "sailed", serviceDate: date, at: Date.parse(`${date}T05:06:00Z`), journeyRef: legs[0].id, stop: "Trandal" });
  const report = compareDay({ data: { signalLog }, db, date, lines: ["1136"], legsForLine: () => legs });
  const rows = report.lines["1136"].legs;
  assert.equal(rows[0].collector, "sailed");
  assert.equal(rows[0].app.word, "Gått");
  assert.equal(rows[0].log, "booked");
  assert.equal(rows[0].agree, true);
  assert.equal(rows[1].collector, "not-seen");
  assert.equal(rows[1].agree, false);
  assert.equal(rows[2].comparable, false);
  assert.deepEqual(report.totals, { legs: 3, agree: 1, disagree: 1, noCollectorData: 0 });
  assert.match(reportMarkdown(report), /\| 09:05 \| Trandal \| Standal \| ja \| booked \| Gått \| not-seen \| \*\*nei\*\* \|/);
});

test("utan posisjonar den dagen er ingenting samanlikna", () => {
  const db = openDb(":memory:");
  const report = compareDay({ data: { signalLog }, db, date, lines: ["1136"], legsForLine: () => legs });
  assert.equal(report.totals.noCollectorData, 3);
  assert.equal(report.totals.disagree, 0);
});
