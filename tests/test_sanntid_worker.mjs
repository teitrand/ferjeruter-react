import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { handle, SCHEMA, eventKey, lineView, keyMatches, MIN_INTERVAL_MS, MAX_EVENTS, MAX_POSITIONS, aisView,
  AIS_FRESH_MS, AIS_STALE_MS, AIS_MOORED_FRESH_MS, AIS_MOORED_STALE_MS, AIS_MOORED_MAX_KN } from "../cloudflare/sanntid/src/index.js";
import { AIS_MOORED_FRESH_MS as C_MF, AIS_MOORED_STALE_MS as C_MS, AT_QUAY_MAX_KN, FIX_FRESH_MS, FIX_STALE_MS } from "../packages/core/crossing.js";

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

// --- AIS-posisjonar: POST /v1/positions og `ais` i GET /v1/latest ---

const pos = (over = {}) => ({
  mmsi: "257297400", line: "1136", name: "KVERNES", latitude: 62.2607, longitude: 6.5005, speedKn: 9.2, courseDeg: 44.4,
  heading: 22, navStatus: 0, msgtime: new Date(T0 - 5000).toISOString(), source: "ais", ...over,
});
const postPos = (e, positions, at = T0, key = KEY) => handle(req("/v1/positions", { method: "POST", key, body: { schema: 1, positions } }), e, at);
const latest = async (e, at) => (await handle(req("/v1/latest", { key: null }), e, at)).json();

test("AIS-tersklane i workeren er dei same som i core (crossing.js)", () => {
  assert.equal(AIS_FRESH_MS, FIX_FRESH_MS);
  assert.equal(AIS_STALE_MS, FIX_STALE_MS);
  assert.equal(AIS_MOORED_FRESH_MS, C_MF);
  assert.equal(AIS_MOORED_STALE_MS, C_MS);
  assert.equal(AIS_MOORED_MAX_KN, AT_QUAY_MAX_KN);
});

test("POST /v1/positions: 401 utan nøkkel, og ingenting lagra", async () => {
  const e = env();
  assert.equal((await postPos(e, [pos()], T0, null)).status, 401);
  assert.equal((await postPos(e, [pos()], T0, "feil-nokkel-feil-nokkel")).status, 401);
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM ais_latest").get().n, 0);
});

test("POST /v1/positions lagrar siste per fartøy, GET /v1/latest viser ais per linje", async () => {
  const e = env();
  assert.equal((await postPos(e, [pos(), pos({ mmsi: "257262400", line: "1135", name: "GEIRANGER", speedKn: 0, msgtime: new Date(T0 - 20000).toISOString() })])).status, 204);
  const d = await latest(e, T0);
  assert.equal(d.schema, 1);
  const k = d.lines["1136"].ais;
  assert.deepEqual({ ...k, ageMs: undefined, receivedAt: undefined },
    { source: "ais", mmsi: "257297400", name: "KVERNES", latitude: 62.2607, longitude: 6.5005, speedKn: 9.2, courseDeg: 44.4, heading: 22,
      navStatus: 0, msgtime: new Date(T0 - 5000).toISOString(), receivedAt: undefined, moored: false, ageMs: undefined, state: "live", stale: false, staleReason: null });
  assert.equal(k.ageMs, 5000);
  assert.equal(d.lines["1135"].ais.name, "GEIRANGER");
  assert.equal(d.lines["1135"].ais.moored, true);
  // Utan puls har linja ingen Entur-posisjon, og collector er stale: det står der som før.
  assert.equal(d.lines["1136"].lastKnown, null);
  assert.equal(d.collector.stale, true);
});

test("ais-ferskleik under fart: live ≤ 60 s, siste kjende ≤ 5 min, så ukjend", () => {
  const row = { mmsi: "1", name: null, latitude: 62, longitude: 6, speed_kn: 8, course_deg: 0, heading: 0, nav_status: 0, msgtime: "x", received_at: "y" };
  const at = (ageS, over = {}) => aisView({ ...row, msgtime_ms: T0 - ageS * 1000, ...over }, T0);
  assert.equal(at(60).state, "live");
  assert.equal(at(61).state, "stale");
  assert.equal(at(300).state, "stale");
  const old = at(301);
  assert.deepEqual([old.state, old.stale, old.staleReason], ["unknown", true, "expired"]);
});

test("ais-ferskleik ved kai (under 0,5 kn eller fortøydd): 4 min og 15 min", () => {
  const row = { mmsi: "1", latitude: 62, longitude: 6, course_deg: 0, heading: 0, msgtime: "x", received_at: "y", name: null };
  const at = (ageS, over) => aisView({ ...row, speed_kn: 0, nav_status: 0, msgtime_ms: T0 - ageS * 1000, ...over }, T0);
  assert.equal(at(240).state, "live");
  assert.equal(at(241).state, "stale");
  assert.equal(at(900).state, "stale");
  assert.equal(at(901).state, "unknown");
  assert.equal(at(200, { speed_kn: 0.49 }).moored, true);
  assert.equal(at(200, { speed_kn: 0.5 }).state, "stale", "0,5 kn er under fart");
  assert.equal(at(200, { speed_kn: null, nav_status: 5 }).state, "live", "fortøydd utan fart");
  assert.equal(at(200, { speed_kn: null, nav_status: 0 }).state, "stale", "ukjend fart og ikkje fortøydd: under fart");
});

test("GET /v1/latest rekna ut ved spørsmål: same lagra melding blir stale seinare", async () => {
  const e = env();
  await postPos(e, [pos({ msgtime: new Date(T0).toISOString() })]);
  assert.equal((await latest(e, T0 + 30_000)).lines["1136"].ais.state, "live");
  assert.equal((await latest(e, T0 + 120_000)).lines["1136"].ais.state, "stale");
  assert.equal((await latest(e, T0 + 400_000)).lines["1136"].ais.state, "unknown");
});

test("ei eldre melding skriv ikkje over ei nyare", async () => {
  const e = env();
  await postPos(e, [pos({ msgtime: new Date(T0 - 1000).toISOString(), latitude: 62.3 })]);
  await postPos(e, [pos({ msgtime: new Date(T0 - 9000).toISOString(), latitude: 62.1 })], T0 + 11_000);
  assert.equal((await latest(e, T0 + 12_000)).lines["1136"].ais.latitude, 62.3);
  await postPos(e, [pos({ msgtime: new Date(T0 + 5000).toISOString(), latitude: 62.4 })], T0 + 22_000);
  assert.equal((await latest(e, T0 + 23_000)).lines["1136"].ais.latitude, 62.4);
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM ais_latest").get().n, 1);
});

test("positions: 400 for ugyldig, 413 for for mange, 429 for ofte", async () => {
  const e = env();
  let t = T0;
  const post = (list) => postPos(e, list, (t += 20_000));
  assert.equal((await post([pos({ mmsi: "123" })])).status, 400);
  assert.equal((await post([pos({ source: "entur" })])).status, 400);
  assert.equal((await post([pos({ latitude: 0, longitude: 0 })])).status, 400);
  assert.equal((await post([pos({ latitude: 95 })])).status, 400);
  assert.equal((await post([pos({ speedKn: "fort" })])).status, 400);
  assert.equal((await post([pos({ msgtime: "i går" })])).status, 400);
  assert.equal((await post([pos({ msgtime: new Date(t + 10 * 60_000).toISOString() })])).status, 400);
  assert.equal((await post([])).status, 400);
  assert.equal((await post(Array.from({ length: MAX_POSITIONS + 1 }, () => pos()))).status, 413);
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM ais_latest").get().n, 0);
  const e2 = env();
  assert.equal((await postPos(e2, [pos()], T0)).status, 204);
  const res = await postPos(e2, [pos()], T0 + 4000);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "6");
  assert.equal((await postPos(e2, [pos()], T0 + MIN_INTERVAL_MS.positions)).status, 204);
  // Eigen grense: hendingar og puls blir ikkje stoppa av posisjonar.
  assert.equal((await handle(req("/v1/events", { method: "POST", body: { schema: 1, events: [ev()] } }), e2, T0 + 10_001)).status, 204);
});

test("bakoverkompatibelt: utan AIS-rader er /v1/latest likt som før, med ais er felta frå før uendra", async () => {
  const e = env();
  const lastKnown = { stopName: "Trandal", atStop: true, journeyRef: "J1", latitude: 62.26, longitude: 6.5,
    recordedAt: "2026-10-09T09:19:30Z", validUntil: "2026-10-09T09:21:30Z" };
  const beat = { schema: 1, generatedAt: "2026-10-09T09:19:40Z", health: "ok", source: "stream", lines: { 1136: { lastKnown, observedAt: "2026-10-09T09:19:31Z" } } };
  await handle(req("/v1/heartbeat", { method: "POST", body: beat }), e, T0);
  const before = await latest(e, T0 + 60_000);
  assert.deepEqual(Object.keys(before).sort(), ["collector", "generatedAt", "lines", "schema", "today"]);
  assert.deepEqual(Object.keys(before.lines["1136"]).sort(), ["lastKnown", "observedAt", "stale", "staleReason"]);
  await postPos(e, [pos({ msgtime: new Date(T0 + 50_000).toISOString() })], T0 + 40_000);
  const after = await latest(e, T0 + 60_000);
  const { ais, ...rest } = after.lines["1136"];
  assert.ok(ais);
  assert.deepEqual(rest, before.lines["1136"]);
  assert.deepEqual({ ...after, lines: undefined }, { ...before, lines: undefined });
});

test("manglar ais_latest (gammal D1) er /v1/latest framleis OK", async () => {
  const e = env();
  e.DB.raw.exec("DROP TABLE ais_latest");
  const res = await handle(req("/v1/latest", { key: null }), e, T0);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).lines, {});
});
