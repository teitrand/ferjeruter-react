import assert from "node:assert/strict";
import test from "node:test";
import { restActive, todayEvidence } from "../src/main.js";
import { activeSource, buildStatus, isFreshAt, lineStatus } from "../src/status.js";

const now = Date.parse("2026-10-09T10:00:00Z");
const live = (ageS, validS = null) => ({
  line: "1136",
  observedAt: new Date(now - ageS * 1000).toISOString(),
  recordedAt: new Date(now - ageS * 1000).toISOString(),
  validUntil: validS == null ? null : new Date(now + validS * 1000).toISOString(),
});

test("fersk: validUntil i framtida, elles under 3 min sidan recordedAt", () => {
  assert.equal(isFreshAt(live(10, 60), now), true);
  assert.equal(isFreshAt(live(10, -1), now), false);
  assert.equal(isFreshAt(live(170), now), true);
  assert.equal(isFreshAt(live(190), now), false);
  assert.equal(isFreshAt(null, now), false);
});

test("stale-grunn: no-data, expired, source-down, og siste kjende blir med", () => {
  assert.deepEqual(
    { ...lineStatus(null, { nowMs: now, source: "stream" }) },
    { stale: true, staleReason: "no-data", observedAt: null, recordedAt: null, validUntil: null, ageSeconds: null, lastKnown: null }
  );
  const old = live(3600);
  const expired = lineStatus(old, { nowMs: now, source: "stream" });
  assert.equal(expired.stale, true);
  assert.equal(expired.staleReason, "expired");
  assert.equal(expired.ageSeconds, 3600);
  assert.equal(expired.lastKnown, old);
  assert.equal(lineStatus(old, { nowMs: now, source: null }).staleReason, "source-down");
  assert.equal(lineStatus(null, { nowMs: now, source: null }).staleReason, "source-down");
  const fresh = lineStatus(live(5, 100), { nowMs: now, source: "stream" });
  assert.equal(fresh.stale, false);
  assert.equal(fresh.staleReason, null);
});

test("kjelde: straum når tilkopla, REST berre når nyleg og utan feil", () => {
  assert.equal(activeSource({ connected: true }, null, now), "stream");
  assert.equal(activeSource({ connected: false }, { lastRequestAt: new Date(now - 60000).toISOString(), lastError: null }, now), "rest");
  assert.equal(activeSource({ connected: false }, { lastRequestAt: new Date(now - 60000).toISOString(), lastError: "HTTP 429" }, now), null);
  assert.equal(activeSource({ connected: false }, { lastRequestAt: new Date(now - 600000).toISOString() }, now), null);
});

test("health: ok, degraded (berre gamle data), down", () => {
  const base = { nowMs: now, startedAt: "s", lines: ["1136", "1135"], rest: null };
  assert.equal(buildStatus({ ...base, lastKnown: {}, stream: { connected: true } }).health, "ok");
  assert.equal(buildStatus({ ...base, lastKnown: { 1136: live(4000) }, stream: { connected: false } }).health, "degraded");
  const down = buildStatus({ ...base, lastKnown: {}, stream: { connected: false } });
  assert.equal(down.health, "down");
  assert.equal(down.lines["1135"].staleReason, "source-down");
  assert.equal(down.sender.enabled, false);
  assert.equal(down.schema, 1);
});

test("REST tek over etter to minutt utan straum, og alltid i rest-modus", () => {
  assert.equal(restActive({ mode: "stream", streamConnected: true, streamDownSince: null, nowMs: now }), false);
  assert.equal(restActive({ mode: "stream", streamConnected: false, streamDownSince: now - 60000, nowMs: now }), false);
  assert.equal(restActive({ mode: "stream", streamConnected: false, streamDownSince: now - 120000, nowMs: now }), true);
  assert.equal(restActive({ mode: "rest", streamConnected: true, streamDownSince: null, nowMs: now }), true);
});

test("dagens bevis har tomme lister for linjer utan hendingar", () => {
  const t = todayEvidence(["1136", "1135"], "2026-10-09", { 1136: { sailed: ["A"], cancelled: [], departures: [] } });
  assert.deepEqual(t.lines["1135"], { sailed: [], cancelled: [], departures: [] });
  assert.deepEqual(t.lines["1136"].sailed, ["A"]);
});
