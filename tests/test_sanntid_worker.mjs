import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { handle, SCHEMA, eventKey, lineView, keyMatches, MIN_INTERVAL_MS, MAX_EVENTS } from "../cloudflare/sanntid/src/index.js";

/** Minimal D1-etterlikning over node:sqlite (prepare/bind/first/all/run/batch). */
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  for (const sql of SCHEMA) db.exec(sql);
  const make = (sql, args = []) => ({
    bind: (...a) => make(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => db.prepare(sql).run(...args),
  });
  return {
    raw: db,
    prepare: (sql) => make(sql),
    batch: async (stmts) => {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

const KEY = "test-nokkel-som-er-lang-nok-1234";
const T0 = Date.parse("2026-10-09T09:20:00Z");
const env = () => ({ DB: fakeD1(), COLLECTOR_KEY: KEY });
const req = (path, { method = "GET", key = KEY, body } = {}) =>
  new Request(`https://x.example${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(key ? { "X-Fergeruter-Key": key } : {}) },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const ev = (over = {}) => ({
  line: "1136", kind: "sailed", serviceDate: "2026-10-09", at: "2026-10-09T09:06:00.000Z",
  journeyRef: "MOR:ServiceJourney:1136_101", stop: null,
  detail: { departure: "11:05:00", from: "Trandal", to: "Standal", signal: true }, ...over,
});

test("feil eller manglande nøkkel gjev 401 og ingenting lagra", async () => {
  const e = env();
  for (const key of [null, "feil", KEY + "x"]) {
    const res = await handle(req("/v1/events", { method: "POST", key, body: { schema: 1, events: [ev()] } }), e, T0);
    assert.equal(res.status, 401);
  }
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM events").get().n, 0);
  assert.equal(await keyMatches(KEY, undefined), false);
  assert.equal(await keyMatches(KEY, "kort"), false);
});

test("hendingar blir lagra idempotent med 204", async () => {
  const e = env();
  const body = { schema: 1, events: [ev(), ev({ kind: "departed", stop: "Trandal", slot: "11:06" })] };
  assert.equal((await handle(req("/v1/events", { method: "POST", body }), e, T0)).status, 204);
  assert.equal((await handle(req("/v1/events", { method: "POST", body }), e, T0 + MIN_INTERVAL_MS.events)).status, 204);
  const rows = e.DB.raw.prepare("SELECT key, detail FROM events ORDER BY key").all();
  assert.equal(rows.length, 2);
  assert.ok(rows.some((r) => r.key === eventKey(ev())));
  assert.deepEqual(JSON.parse(rows.find((r) => r.key === eventKey(ev())).detail).to, "Standal");
});

test("feil form gjev 400, for mange eller for stort gjev 413", async () => {
  const e = env();
  let t = T0;
  const post = (body) => handle(req("/v1/events", { method: "POST", body }), e, (t += 20_000));
  assert.equal((await post("ikkje json")).status, 400);
  assert.equal((await post({ schema: 2, events: [ev()] })).status, 400);
  assert.equal((await post({ schema: 1, events: [] })).status, 400);
  assert.equal((await post({ schema: 1, events: [ev({ kind: "teleport" })] })).status, 400);
  assert.equal((await post({ schema: 1, events: [ev({ serviceDate: "9.10" })] })).status, 400);
  assert.equal((await post({ schema: 1, events: Array.from({ length: MAX_EVENTS + 1 }, (_, i) => ev({ slot: String(i) })) })).status, 413);
  assert.equal((await post({ schema: 1, events: [ev({ detail: { x: "y".repeat(70_000) } })] })).status, 413);
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM events").get().n, 0);
});

test("429 med Retry-After om innsamlaren sender for ofte", async () => {
  const e = env();
  const post = (at) => handle(req("/v1/events", { method: "POST", body: { schema: 1, events: [ev()] } }), e, at);
  assert.equal((await post(T0)).status, 204);
  const res = await post(T0 + 4000);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "6");
  assert.equal((await post(T0 + MIN_INTERVAL_MS.events)).status, 204);
  // Puls har eiga grense og blir ikkje stoppa av hendingar.
  const hb = await handle(req("/v1/heartbeat", { method: "POST", body: { schema: 1, generatedAt: new Date(T0).toISOString(), lines: {} } }), e, T0 + 10_001);
  assert.equal(hb.status, 204);
});

test("GET /v1/latest utan data: collector stale og no-data, CORS og cache", async () => {
  const res = await handle(req("/v1/latest", { key: null }), env(), T0);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=15");
  const d = await res.json();
  assert.equal(d.schema, 1);
  assert.deepEqual(d.collector, { lastHeartbeatAt: null, stale: true });
  assert.deepEqual(d.lines, {});
  assert.deepEqual(d.today, { date: "2026-10-09", lines: {} });
  assert.equal((await handle(req("/v1/latest", { method: "OPTIONS", key: null }), env(), T0)).status, 204);
  assert.equal((await handle(req("/v1/latest", { method: "POST", key: null, body: {} }), env(), T0)).status, 405);
  assert.equal((await handle(req("/", { key: null }), env(), T0)).status, 404);
});

test("GET /v1/latest med puls og hendingar", async () => {
  const e = env();
  const lastKnown = { stopName: "Trandal", atStop: true, journeyRef: "J1", latitude: 62.26, longitude: 6.5,
    recordedAt: "2026-10-09T09:19:30Z", validUntil: "2026-10-09T09:21:30Z" };
  const beat = { schema: 1, generatedAt: "2026-10-09T09:19:40Z", health: "ok", source: "stream",
    lines: { 1136: { lastKnown, observedAt: "2026-10-09T09:19:31Z" }, 1135: { lastKnown: null, observedAt: null } } };
  assert.equal((await handle(req("/v1/heartbeat", { method: "POST", body: beat }), e, T0)).status, 204);
  await handle(req("/v1/events", { method: "POST", body: { schema: 1, events: [
    ev(), ev({ kind: "cancelled", journeyRef: "J9", detail: null }), ev({ kind: "departed", stop: "Trandal", slot: "11:06", journeyRef: "J1" }),
    ev({ serviceDate: "2026-10-08", journeyRef: "GAMMAL" }),
  ] } }), e, T0);
  let d = await (await handle(req("/v1/latest", { key: null }), e, T0 + 60_000)).json();
  assert.equal(d.collector.stale, false);
  assert.equal(d.lines[1136].stale, false);
  assert.equal(d.lines[1136].staleReason, null);
  assert.deepEqual(d.lines[1136].lastKnown, lastKnown);
  assert.equal(d.lines[1135].staleReason, "no-data");
  assert.deepEqual(d.today.lines[1136].sailed, ["MOR:ServiceJourney:1136_101"]);
  assert.deepEqual(d.today.lines[1136].cancelled, ["J9"]);
  assert.equal(d.today.lines[1136].departures.length, 1);
  // 3 min seinare: posisjonen er gammal, innsamlaren lever.
  d = await (await handle(req("/v1/latest", { key: null }), e, T0 + 3 * 60_000)).json();
  assert.equal(d.lines[1136].staleReason, "expired");
  // 6 min utan puls: collector-down.
  d = await (await handle(req("/v1/latest", { key: null }), e, T0 + 6 * 60_000)).json();
  assert.equal(d.collector.stale, true);
  assert.equal(d.lines[1136].staleReason, "collector-down");
});

test("lineView: utan validUntil gjeld recordedAt + 3 min", () => {
  const lk = { recordedAt: "2026-10-09T09:19:00Z" };
  assert.equal(lineView({ lastKnown: lk }, { collectorStale: false, nowMs: Date.parse("2026-10-09T09:21:59Z") }).stale, false);
  assert.equal(lineView({ lastKnown: lk }, { collectorStale: false, nowMs: Date.parse("2026-10-09T09:22:01Z") }).stale, true);
});

test("gamle pulsar og hendingar blir sletta ved puls", async () => {
  const e = env();
  e.DB.raw.prepare("INSERT INTO heartbeats (received_at, body) VALUES (?, '{}')").run("2026-10-01T00:00:00.000Z");
  e.DB.raw.prepare("INSERT INTO events (key, service_date, line, kind, at, received_at) VALUES ('k','2026-09-01','1136','sailed','2026-09-01T10:00:00Z','2026-09-01T10:00:00.000Z')").run();
  await handle(req("/v1/heartbeat", { method: "POST", body: { schema: 1, generatedAt: "2026-10-09T09:19:40Z", lines: {} } }), e, T0);
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM heartbeats").get().n, 1);
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM events").get().n, 0);
});

test("format som innsamlaren sender (sender.js + tracker) blir godteke", async () => {
  const e = env();
  const fromCollector = { line: "1135", kind: "arrived", serviceDate: "2026-10-09", at: "2026-10-09T09:10:00.000Z",
    journeyRef: "MOR:ServiceJourney:1135_7", stop: "Sæbø", slot: "11:10", detail: null, vehicleId: "x", observedAt: 1 };
  assert.equal((await handle(req("/v1/events", { method: "POST", body: { schema: 1, events: [fromCollector] } }), e, T0)).status, 204);
});
