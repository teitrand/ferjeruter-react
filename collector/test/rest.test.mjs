import assert from "node:assert/strict";
import test from "node:test";
import { RESTART_GAP_MS, createRestPoller, restartBlockUntil } from "../src/rest.js";

const vmEmpty = () => new Response(JSON.stringify({ Siri: { ServiceDelivery: {} } }), { status: 200 });

test("REST: eige ET-Client-Name for innsamlaren", async () => {
  let clock = Date.parse("2026-10-09T08:00:00Z");
  const reqs = [];
  const poller = createRestPoller({ lines: ["1136"], onVehicle: () => {}, now: () => clock, fetchImpl: async (url, init) => (reqs.push(init), vmEmpty()) });
  await poller.tick();
  assert.equal(reqs[0].headers["ET-Client-Name"], "teitrand-fergeruter-innsamlar");
});

test("REST: rategrensa held over omstart (krasjløkke i rest-modus)", async () => {
  let clock = Date.parse("2026-10-09T08:00:00Z");
  const meta = {};
  const persist = { load: () => meta.restRate ?? null, save: (v) => (meta.restRate = structuredClone(v)) };
  let calls = 0;
  const fetchImpl = async () => (calls++, vmEmpty());
  const make = () => createRestPoller({ lines: ["1136", "1135"], onVehicle: () => {}, now: () => clock, fetchImpl, persist });
  await make().tick();
  assert.equal(calls, 1);
  assert.equal(meta.restRate.lastRequestAt, clock);
  // Ti «omstartar» med 5 s mellomrom: ingen nye kall før 60 s etter førre.
  for (let i = 0; i < 10; i++) {
    clock += 5000;
    const p = make();
    await p.tick();
    if (clock - meta.restRate.lastRequestAt < RESTART_GAP_MS) assert.equal(calls, 1, `kall etter ${i + 1} omstartar`);
  }
  assert.ok(calls <= 2, String(calls));
});

test("REST: 429-blokk blir lagra og gjeld etter omstart", async () => {
  let clock = Date.parse("2026-10-09T08:00:00Z");
  const meta = {};
  const persist = { load: () => meta.restRate ?? null, save: (v) => (meta.restRate = structuredClone(v)) };
  let calls = 0;
  const fetchImpl = async () => (calls++, new Response("", { status: 429, headers: { "retry-after": "600" } }));
  await createRestPoller({ lines: ["1136"], onVehicle: () => {}, now: () => clock, fetchImpl, persist }).tick();
  assert.ok(meta.restRate.blockedUntil >= clock + 600000);
  clock += 120000;
  await createRestPoller({ lines: ["1136"], onVehicle: () => {}, now: () => clock, fetchImpl, persist }).tick();
  assert.equal(calls, 1);
});

test("restartBlockUntil: tom, siste kall + 60 s, og maks éin time fram", () => {
  const now = 1_000_000_000;
  assert.equal(restartBlockUntil(null, now), 0);
  assert.equal(restartBlockUntil({ lastRequestAt: now - 10000 }, now), now + 50000);
  assert.equal(restartBlockUntil({ blockedUntil: now + 10 * 3600000 }, now), now + 3600000);
});
