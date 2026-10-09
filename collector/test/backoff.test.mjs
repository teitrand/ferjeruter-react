import assert from "node:assert/strict";
import test from "node:test";
import { createBackoff, retryAfterMs } from "../src/backoff.js";
import { nextReconnectDelay, RECONNECT_MAX_MS } from "../src/stream.js";

test("Retry-After i sekund og som dato", () => {
  assert.equal(retryAfterMs("120"), 120000);
  assert.equal(retryAfterMs(""), 0);
  assert.equal(retryAfterMs(null), 0);
  assert.equal(retryAfterMs("tull"), 0);
  const now = Date.parse("2026-10-09T10:00:00Z");
  assert.equal(retryAfterMs("Fri, 09 Oct 2026 10:01:00 GMT", now), 60000);
});

test("backoff doblar frå 1 til 15 min og blir nullstilt", () => {
  const b = createBackoff();
  const waits = [];
  for (let i = 0; i < 7; i++) waits.push((b.fail(0) - 0) / 60000);
  assert.deepEqual(waits, [1, 2, 4, 8, 15, 15, 15]);
  assert.equal(b.failures, 7);
  b.succeed();
  assert.equal(b.blockedUntil, 0);
  assert.equal(b.fail(0) / 60000, 1);
});

test("Retry-After lenger enn backoff vinn", () => {
  const b = createBackoff();
  assert.equal(b.fail(0, 600000), 600000);
});

test("ny websocket-tilkopling: 15 s og dobling opp til 15 min", () => {
  let d = 0;
  const seen = [];
  for (let i = 0; i < 9; i++) seen.push((d = nextReconnectDelay(d)) / 1000);
  assert.deepEqual(seen, [15, 30, 60, 120, 240, 480, 900, 900, 900]);
  assert.equal(RECONNECT_MAX_MS, 900000);
});
