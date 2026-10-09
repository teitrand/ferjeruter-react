import assert from "node:assert/strict";
import test from "node:test";
import { createRateLimiter, guardedFetch, RateLimitError } from "../src/ratelimit.js";
import { createRestPoller } from "../src/rest.js";

/** Sjekkar ei liste med kalltider mot Entur sine grenser. */
function assertWithinEntur(times, { perMinute = 4, minGap = 15000 } = {}) {
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i] - times[i - 1] >= minGap, `for tett: ${times[i] - times[i - 1]} ms`);
  }
  for (let i = 0; i < times.length; i++) {
    const inWindow = times.filter((t) => t >= times[i] && t < times[i] + 60000).length;
    assert.ok(inWindow <= perMinute, `${inWindow} kall på 60 s frå ${times[i]}`);
  }
}

test("grenser over Entur sine blir avviste ved oppstart", () => {
  assert.throws(() => createRateLimiter({ maxPerWindow: 5 }), /For mange/);
  assert.throws(() => createRateLimiter({ maxPerWindow: 3, windowMs: 30000 }), /For mange/);
  assert.throws(() => createRateLimiter({ minIntervalMs: 10000 }), /For kort/);
  assert.throws(() => createRateLimiter({ maxPerWindow: 0 }), /For mange/);
});

test("tilfeldige kall i seks timar går aldri over grensa", () => {
  let clock = 0;
  const limiter = createRateLimiter({ now: () => clock });
  const granted = [];
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  while (clock < 6 * 3600000) {
    // Byger av kall (ein «feil» som spør i loop) og stille periodar.
    const burst = rand() < 0.2 ? 50 : 1;
    for (let i = 0; i < burst; i++) if (limiter.tryAcquire()) granted.push(clock);
    clock += Math.floor(rand() * 8000);
  }
  assert.ok(granted.length > 100, "skal sleppe gjennom kall");
  assertWithinEntur(granted, { perMinute: 2, minGap: 30000 });
  assertWithinEntur(granted);
});

test("blockUntil stoppar kall og blir aldri forkorta", () => {
  let clock = 0;
  const limiter = createRateLimiter({ now: () => clock });
  limiter.blockUntil(120000);
  limiter.blockUntil(60000);
  clock = 119999;
  assert.equal(limiter.tryAcquire(), false);
  assert.equal(limiter.waitMs(), 1);
  clock = 120000;
  assert.equal(limiter.tryAcquire(), true);
});

test("guardedFetch kallar ikkje fetch når grensa er nådd", async () => {
  let clock = 0;
  let calls = 0;
  const limiter = createRateLimiter({ now: () => clock });
  const f = guardedFetch(limiter, async () => {
    calls += 1;
    return new Response("{}");
  });
  await f("https://x");
  await assert.rejects(() => f("https://x"), RateLimitError);
  assert.equal(calls, 1);
});

function fakeClock() {
  const c = { t: Date.parse("2026-10-09T08:00:00Z") };
  c.now = () => c.t;
  return c;
}

const okBody = { Siri: { ServiceDelivery: { VehicleMonitoringDelivery: [{}] } } };

test("REST-reserven: maks éin gong per 60 s per linje og innanfor Entur sine grenser", async () => {
  const clock = fakeClock();
  const calls = [];
  const poller = createRestPoller({
    lines: ["1136", "1135"],
    onVehicle: () => {},
    now: clock.now,
    fetchImpl: async (url) => {
      calls.push({ url, t: clock.t });
      return new Response(JSON.stringify(okBody), { status: 200 });
    },
  });
  for (let i = 0; i < 2 * 3600; i++) {
    await poller.tick();
    await poller.tick();
    clock.t += 1000;
  }
  assertWithinEntur(calls.map((c) => c.t), { perMinute: 2, minGap: 30000 });
  assertWithinEntur(calls.map((c) => c.t));
  for (const line of ["1136", "1135"]) {
    const times = calls.filter((c) => c.url.includes(line)).map((c) => c.t);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 60000);
    assert.ok(times.length >= 110, `${line}: ${times.length} kall på to timar`);
  }
});

test("REST-reserven: 429 med Retry-After og 500 gjev pause med dobling", async () => {
  const clock = fakeClock();
  const calls = [];
  let status = 429;
  const poller = createRestPoller({
    lines: ["1136"],
    onVehicle: () => {},
    now: clock.now,
    fetchImpl: async () => {
      calls.push(clock.t);
      return new Response("{}", { status, headers: status === 429 ? { "Retry-After": "300" } : {} });
    },
  });
  const run = async (seconds) => {
    for (let i = 0; i < seconds; i++) {
      await poller.tick();
      clock.t += 1000;
    }
  };
  await run(1);
  assert.equal(calls.length, 1);
  await run(299);
  assert.equal(calls.length, 1, "ingen kall før Retry-After er ute");
  status = 500;
  await run(2);
  assert.equal(calls.length, 2);
  const gap1 = calls[1] - calls[0];
  await run(1800);
  const gaps = calls.slice(1).map((t, i) => t - calls[i]);
  assert.ok(gap1 >= 300000);
  for (let i = 2; i < gaps.length; i++) assert.ok(gaps[i] >= gaps[i - 1] || gaps[i] >= 15 * 60000, `dobling: ${gaps}`);
  assert.ok(gaps.at(-1) >= 8 * 60000, "backoff veks mot 15 min");
  assert.equal(poller.status().errors, calls.length);
});

test("REST-reserven: nettverksfeil gjev backoff, og spør ikkje utanfor driftstida", async () => {
  const clock = fakeClock();
  let calls = 0;
  let inService = false;
  const poller = createRestPoller({
    lines: ["1136"],
    onVehicle: () => {},
    now: clock.now,
    inService: () => inService,
    fetchImpl: async () => {
      calls += 1;
      throw new Error("ECONNRESET");
    },
  });
  for (let i = 0; i < 600; i++, clock.t += 1000) await poller.tick();
  assert.equal(calls, 0);
  inService = true;
  for (let i = 0; i < 59; i++, clock.t += 1000) await poller.tick();
  assert.equal(calls, 1);
  assert.ok(poller.backoff.blockedUntil > clock.t);
});
