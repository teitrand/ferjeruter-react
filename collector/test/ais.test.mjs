import assert from "node:assert/strict";
import test from "node:test";
import {
  AIS_HEALTHY_AFTER_MS,
  AIS_PLANNED_RECONNECT_MS,
  AIS_WATCHDOG_MS,
  aisStatus,
  createAisStream,
  createSseParser,
  createTokenSource,
  fromAisMessage,
  parseMmsiMap,
} from "../src/ais.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";

const SECRET = "hemmeleg-passord-123";
const TOKEN = "tok.en.FAKE";
const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

function fakeTime() {
  const t = { now: Date.parse("2026-10-09T17:00:00Z"), timers: [] };
  t.set = (fn, ms) => {
    const timer = { at: t.now + ms, fn };
    t.timers.push(timer);
    return timer;
  };
  t.clear = (timer) => {
    t.timers = t.timers.filter((x) => x !== timer);
  };
  t.advance = async (ms) => {
    const end = t.now + ms;
    for (;;) {
      t.timers.sort((a, b) => a.at - b.at);
      const next = t.timers[0];
      if (!next || next.at > end) break;
      t.timers.shift();
      t.now = next.at;
      next.fn();
      await flush();
    }
    t.now = end;
    await flush();
  };
  return t;
}

/** SSE-kropp vi styrer: push(tekst), end(), og avbrot via signal. */
function fakeBody(signal) {
  const queue = [];
  let waiting = null;
  let ended = false;
  const enc = new TextEncoder();
  const wake = () => {
    if (!waiting) return;
    const w = waiting;
    if (queue.length) {
      waiting = null;
      w.resolve({ value: enc.encode(queue.shift()), done: false });
    } else if (ended) {
      waiting = null;
      w.resolve({ value: undefined, done: true });
    }
  };
  signal?.addEventListener("abort", () => {
    if (waiting) {
      const w = waiting;
      waiting = null;
      w.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    }
  });
  return {
    push(text) {
      queue.push(text);
      wake();
    },
    end() {
      ended = true;
      wake();
    },
    getReader() {
      return { read: () => new Promise((resolve, reject) => { waiting = { resolve, reject }; wake(); }) };
    },
  };
}

/** Falsk fetch for både token og SSE. `sse` er ei liste med svar som blir brukte i tur og orden. */
function fakeFetch({ tokenStatus = () => 200, sseStatus = () => 200 } = {}) {
  const calls = { token: [], sse: [], bodies: [] };
  let tokenN = 0;
  const fetchImpl = async (url, init) => {
    if (url.includes("connect/token")) {
      calls.token.push(init);
      const status = tokenStatus(calls.token.length);
      tokenN += 1;
      return { ok: status === 200, status, headers: { get: () => null }, json: async () => ({ access_token: `${TOKEN}${tokenN}`, expires_in: 3600, token_type: "Bearer", scope: "ais" }) };
    }
    calls.sse.push(init);
    const status = sseStatus(calls.sse.length);
    const body = fakeBody(init.signal);
    calls.bodies.push(body);
    return { ok: status === 200, status, headers: { get: (h) => (h === "retry-after" && status === 429 ? "120" : null) }, body };
  };
  return { fetchImpl, calls };
}

function setup(opts = {}) {
  const time = fakeTime();
  const { fetchImpl, calls } = fakeFetch(opts);
  const logs = [];
  const got = [];
  const tokens = createTokenSource({ clientId: "TEST@EXAMPLE.COM:fergeruter-innsamlar", clientSecret: SECRET, fetchImpl, now: () => time.now });
  const ais = createAisStream({
    mmsi: parseMmsiMap(),
    tokens,
    onPosition: (live) => got.push(live),
    log: (msg, extra) => logs.push(JSON.stringify({ msg, ...extra })),
    fetchImpl,
    now: () => time.now,
    setTimer: time.set,
    clearTimer: time.clear,
  });
  return { time, calls, logs, got, tokens, ais };
}

const kvernes = (msgtime, extra = {}) =>
  JSON.stringify({ mmsi: 257297400, msgtime, latitude: 62.260655, longitude: 6.500472, speedOverGround: 0, courseOverGround: 44.4, trueHeading: 22, navigationalStatus: 0, name: "KVERNES", ...extra });

test("MMSI-kart: standard er Kvernes 1136 og Geiranger 1135, ugyldige delar blir hoppa over", () => {
  assert.deepEqual([...parseMmsiMap()], [[257297400, "1136"], [257262400, "1135"]]);
  assert.deepEqual([...parseMmsiMap("123:1, 257297400:1136, x:y")], [[257297400, "1136"]]);
});

test("SSE-parsar: delte bitar, CRLF, kommentarar, fleirlinja data og hendingsnamn", () => {
  const got = [];
  let comments = 0;
  const p = createSseParser((data, name) => got.push([name, data]), () => comments++);
  p.feed(": keepalive\r\n\r\nda");
  p.feed('ta: {"a":');
  p.feed("1}\n\nevent: x\ndata: l1\ndata: l2\r\n\r\n");
  assert.deepEqual(got, [["message", '{"a":1}'], ["x", "l1\nl2"]]);
  assert.equal(comments, 1);
});

test("AIS-melding blir posisjon med source ais, kai og fart; heading 511 = ukjend", () => {
  const live = fromAisMessage(JSON.parse(kvernes("2026-10-09T17:11:42+00:00")), "1136", "2026-10-09T17:11:43.000Z");
  assert.equal(live.source, "ais");
  assert.equal(live.vehicleId, "mmsi:257297400");
  assert.equal(live.recordedAt, "2026-10-09T17:11:42+00:00");
  assert.equal(live.stopName, "Trandal");
  assert.equal(live.speedKn, 0);
  assert.equal(live.heading, 22);
  assert.equal(fromAisMessage({ mmsi: 1, msgtime: "x", latitude: 62, longitude: 6, trueHeading: 511 }, "1").heading, null);
  assert.equal(fromAisMessage({ mmsi: 1, msgtime: "x" }, "1"), null, "utan posisjon: ingenting");
});

test("token: client_credentials med scope ais i body, gjenbruk, nytt når levetida er for kort, 60 s pause etter feil", async () => {
  let now = 0;
  let fail = false;
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(Object.fromEntries(new URLSearchParams(init.body)));
    if (fail) return { ok: false, status: 400, headers: { get: () => null } };
    return { ok: true, status: 200, json: async () => ({ access_token: `t${seen.length}`, expires_in: 3600 }) };
  };
  const tokens = createTokenSource({ clientId: "A@B.C:klient", clientSecret: SECRET, fetchImpl, now: () => now });
  assert.equal(await tokens.get(), "t1");
  assert.deepEqual(seen[0], { grant_type: "client_credentials", client_id: "A@B.C:klient", client_secret: SECRET, scope: "ais" });
  now += 4 * 60000;
  assert.equal(await tokens.get(), "t1", "56 min att: gjenbrukt");
  now += 2 * 60000;
  assert.equal(await tokens.get(), "t2", "54 min att: for kort for ei 50-min tilkopling");
  tokens.invalidate();
  fail = true;
  await assert.rejects(tokens.get(), /HTTP 400/);
  await assert.rejects(tokens.get(), /ventar/);
  assert.equal(seen.length, 3, "ingen nytt kall før 60 s");
  now += 60000;
  fail = false;
  assert.equal(await tokens.get(), "t4");
  assert.doesNotMatch(JSON.stringify(tokens.state), new RegExp(SECRET));
});

test("straum: POST med MMSI-filter, Full, utan nedsampling; berre våre MMSI blir posisjonar", async () => {
  const { time, calls, got, ais } = setup();
  ais.start();
  await time.advance(0);
  assert.equal(calls.sse.length, 1);
  const init = calls.sse[0];
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Accept, "text/event-stream");
  assert.match(init.headers.Authorization, /^Bearer tok\.en\.FAKE1$/);
  assert.deepEqual(JSON.parse(init.body), { mmsi: [257297400, 257262400], modelType: "Full", downsample: false });
  assert.equal(ais.state.connected, true);
  calls.bodies[0].push(`data: ${kvernes("2026-10-09T17:00:01+00:00")}\n\n`);
  calls.bodies[0].push(`data: ${JSON.stringify({ mmsi: 999999999, msgtime: "x", latitude: 60, longitude: 5 })}\n\n: ka\n\n`);
  await time.advance(0);
  assert.equal(got.length, 1);
  assert.equal(got[0].line, "1136");
  assert.equal(ais.state.ignored, 1);
  assert.equal(ais.state.comments, 1);
  assert.equal(ais.state.vessels[257297400].msgtime, "2026-10-09T17:00:01+00:00");
  assert.equal(ais.state.vessels[257262400].msgtime, null);
  ais.stop();
});

test("feil: 401 gjev nytt token; backoff 15 → 30 → … → 15 min, nullstilt berre etter ≥ 2 min oppetid", async () => {
  let fails = true;
  const { time, calls, ais, logs } = setup({ sseStatus: () => (fails ? 401 : 200) });
  ais.start();
  await time.advance(0);
  const gaps = [];
  for (let i = 0; i < 8; i++) {
    const before = calls.sse.length;
    const at = time.now;
    while (calls.sse.length === before) await time.advance(1000);
    gaps.push((time.now - at) / 1000);
  }
  // Fyrste gap er etter det fyrste 401-svaret.
  assert.deepEqual(gaps, [15, 30, 60, 120, 240, 480, 900, 900]);
  assert.ok(calls.token.length >= 8, "401 gjer tokenet ugyldig, så kvar tilkopling hentar nytt");
  fails = false;
  const before = calls.sse.length;
  while (calls.sse.length === before) await time.advance(1000);
  assert.equal(ais.state.connected, true);
  // Lever 1 min, døyr: backoff held fram (900).
  await time.advance(60000);
  calls.bodies.at(-1).end();
  await time.advance(0);
  assert.equal(ais.state.reconnectDelayMs, 900000);
  await time.advance(900000);
  assert.equal(ais.state.connected, true);
  // Lever ≥ 2 min med data: neste brot gjev 15 s.
  for (let s = 0; s < AIS_HEALTHY_AFTER_MS / 30000; s++) {
    calls.bodies.at(-1).push(`data: ${kvernes(new Date(time.now).toISOString())}\n\n`);
    await time.advance(30000);
  }
  calls.bodies.at(-1).end();
  await time.advance(0);
  assert.equal(ais.state.reconnectDelayMs, 15000);
  assert.ok(logs.some((l) => l.includes('"ais-http-feil"') && l.includes("401")));
  ais.stop();
});

test("429 med Retry-After: ventar minst så lenge", async () => {
  const { time, calls, ais } = setup({ sseStatus: (n) => (n === 1 ? 429 : 200) });
  ais.start();
  await time.advance(0);
  assert.match(ais.state.nextConnectAt, /T17:02:00/);
  await time.advance(119000);
  assert.equal(calls.sse.length, 1);
  await time.advance(1000);
  assert.equal(calls.sse.length, 2);
  ais.stop();
});

test("planlagt ny tilkopling kvar 50. min med nytt token, utan backoff", async () => {
  const { time, calls, ais } = setup();
  ais.start();
  await time.advance(0);
  for (let m = 0; m < 50; m++) {
    calls.bodies.at(-1).push(`data: ${kvernes(new Date(time.now).toISOString())}\n\n`);
    await time.advance(60000);
  }
  await time.advance(2000);
  assert.equal(calls.sse.length, 2);
  assert.equal(ais.state.reconnectDelayMs, 0);
  assert.equal(calls.token.length, 2, "nytt token: det gamle hadde berre 10 min att");
  assert.match(calls.sse[1].headers.Authorization, /FAKE2$/);
  assert.ok(AIS_PLANNED_RECONNECT_MS < 3600000);
  ais.stop();
});

test("vakthund: ingen byte på 10 min gjev ny tilkopling", async () => {
  const { time, calls, ais } = setup();
  ais.start();
  await time.advance(0);
  await time.advance(AIS_WATCHDOG_MS - 1000);
  assert.equal(calls.sse.length, 1);
  await time.advance(1000);
  assert.match(ais.state.lastError, /vakthund/);
  await time.advance(15000);
  assert.equal(calls.sse.length, 2);
  ais.stop();
});

test("passord og token finst aldri i logg eller status", async () => {
  const { time, calls, ais, logs, tokens } = setup({ sseStatus: (n) => (n === 1 ? 401 : 200) });
  ais.start();
  await time.advance(0);
  await time.advance(20000);
  assert.equal(ais.state.connected, true);
  calls.bodies.at(-1).push(`data: ${kvernes("2026-10-09T17:00:30+00:00")}\n\n`);
  await time.advance(0);
  const status = JSON.stringify(aisStatus({ enabled: true }, ais, tokens));
  const all = logs.join("\n") + status;
  assert.doesNotMatch(all, new RegExp(SECRET));
  assert.doesNotMatch(all, /FAKE/);
  assert.match(status, /"tokenValidUntil":"2026-10-09T18:00:15/);
  ais.stop();
});

test("oppsett: AIS er av som standard, og av utan passord sjølv om det er bede om", () => {
  assert.equal(loadConfig({}).ais.enabled, false);
  const noSecret = loadConfig({ FERGERUTER_AIS_ENABLED: "1", FERGERUTER_AIS_CLIENT_ID: "a:b" });
  assert.deepEqual([noSecret.ais.enabled, noSecret.ais.requested, noSecret.ais.configured], [false, true, false]);
  const off = loadConfig({ FERGERUTER_AIS_CLIENT_ID: "a:b", FERGERUTER_AIS_CLIENT_SECRET: SECRET });
  assert.equal(off.ais.enabled, false, "konfigurert, men ikkje slått på");
  assert.equal(loadConfig({ FERGERUTER_AIS_ENABLED: "1", FERGERUTER_AIS_CLIENT_ID: "a:b", FERGERUTER_AIS_CLIENT_SECRET: SECRET }).ais.enabled, true);
  assert.doesNotMatch(JSON.stringify(aisStatus(off.ais, null, null)), new RegExp(SECRET));
});

test("lagring: AIS-posisjon med fart, kurs, heading og status; same MMSI og msgtime éin gong", () => {
  const db = openDb(":memory:");
  const live = fromAisMessage(JSON.parse(kvernes("2026-10-09T17:11:42+00:00", { speedOverGround: 11.2 })), "1136", "2026-10-09T17:11:43.000Z");
  assert.equal(db.insertPosition(live), true);
  assert.equal(db.insertPosition({ ...live, observedAt: "2026-10-09T17:11:50.000Z" }), false);
  const row = db.raw.prepare("SELECT source, vehicle_id, recorded_at, speed_kn, course_deg, heading, nav_status, stop_name FROM positions").get();
  assert.deepEqual({ ...row }, { source: "ais", vehicle_id: "mmsi:257297400", recorded_at: "2026-10-09T17:11:42+00:00", speed_kn: 11.2, course_deg: 44.4, heading: 22, nav_status: 0, stop_name: "Trandal" });
  db.close();
});

test("eldre database utan AIS-kolonnar blir oppgradert", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const path = join(mkdtempSync(join(tmpdir(), "ais-")), "old.sqlite");
  const old = new DatabaseSync(path);
  old.exec("CREATE TABLE positions (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, line TEXT NOT NULL, observed_at INTEGER NOT NULL, recorded_at TEXT, source TEXT NOT NULL, vehicle_id TEXT, journey_ref TEXT, latitude REAL, longitude REAL, at_stop INTEGER, stop_name TEXT, destination TEXT, delay_min INTEGER, vehicle_status TEXT, valid_until TEXT)");
  old.close();
  const db = openDb(path);
  const cols = db.raw.prepare("PRAGMA table_info(positions)").all().map((c) => c.name);
  for (const c of ["speed_kn", "course_deg", "heading", "nav_status"]) assert.ok(cols.includes(c), c);
  db.close();
});
