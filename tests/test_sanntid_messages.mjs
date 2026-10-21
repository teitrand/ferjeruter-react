import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handle, SCHEMA, MESSAGES_FRESH_MS, MIN_INTERVAL_MS } from "../cloudflare/sanntid/src/index.js";

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  for (const sql of SCHEMA) db.exec(sql);
  db.exec(readFileSync(new URL("../cloudflare/sanntid/migrations/0003_trafikkmeldinger.sql", import.meta.url), "utf8"));
  const make = (sql, args = []) => ({
    bind: (...a) => make(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => db.prepare(sql).run(...args),
  });
  return { raw: db, prepare: (sql) => make(sql), batch: async (s) => Promise.all(s.map((x) => x.run())) };
}

const KEY = "test-nokkel-som-er-lang-nok-1234";
const T0 = Date.parse("2026-10-21T09:00:00Z");
const req = (path, { method = "GET", key = KEY, body } = {}) =>
  new Request(`https://x.example${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(key ? { "X-Fergeruter-Key": key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const MSG = { id: "a", heading: "Standal-Trandal", content: "Rute 1136: kombinert rute", date: "21.10.2026 08:00:00" };
const fjord1 = (calls) => async () => {
  calls.n += 1;
  const field = (id, v) => ({ fieldDefinitionIdentifier: id, fieldValue: v });
  return new Response(JSON.stringify({ View: { Result: { count: 1, searchHits: { searchHit: [
    { value: { Content: { _id: 7, CurrentVersion: { Version: { Fields: { field: [field("heading", "Frå Fjord1"), field("content", "Rute 1136")] } } } } } },
  ] } } } }));
};

test("trafikkmeldingar: POST krev nøkkel, GET gjev lagra data med fetchedAt og source", async () => {
  const env = { DB: fakeD1(), COLLECTOR_KEY: KEY };
  const body = { schema: 1, fetchedAt: new Date(T0).toISOString(), messages: [MSG] };
  assert.equal((await handle(req("/v1/trafikkmeldinger", { method: "POST", key: "feil", body }), env, T0)).status, 401);
  assert.equal((await handle(req("/v1/trafikkmeldinger", { method: "POST", body: { schema: 1, messages: [] } }), env, T0)).status, 400);
  assert.equal((await handle(req("/v1/trafikkmeldinger", { method: "POST", body }), env, T0)).status, 204);
  // Rate-grense som AIS-push.
  assert.equal((await handle(req("/v1/trafikkmeldinger", { method: "POST", body }), env, T0 + 1000)).status, 429);
  assert.ok(MIN_INTERVAL_MS.trafikkmeldinger <= 60_000);
  const calls = { n: 0 };
  const res = await handle(req("/v1/trafikkmeldinger"), env, T0 + 60_000, { fetchImpl: fjord1(calls) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  const got = await res.json();
  assert.equal(got.fetchedAt, body.fetchedAt);
  assert.equal(got.source, "https://www.fjord1.no/trafikkmeldingar");
  assert.equal(got.origin, "collector");
  assert.deepEqual(got.messages, [MSG]);
  assert.equal(calls.n, 0, "ferske innsamlardata: ingen kall til Fjord1");
});

test("trafikkmeldingar: eldre enn 10 min → workeren hentar sjølv (reserve); feilar Fjord1, gamle data med stale", async () => {
  const env = { DB: fakeD1(), COLLECTOR_KEY: KEY };
  const body = { schema: 1, fetchedAt: new Date(T0).toISOString(), messages: [MSG] };
  await handle(req("/v1/trafikkmeldinger", { method: "POST", body }), env, T0);
  const calls = { n: 0 };
  const later = T0 + MESSAGES_FRESH_MS + 1000;
  const fresh = await (await handle(req("/v1/trafikkmeldinger"), env, later, { fetchImpl: fjord1(calls) })).json();
  assert.equal(calls.n, 1);
  assert.equal(fresh.origin, "worker");
  assert.equal(fresh.messages[0].heading, "Frå Fjord1");
  assert.equal(fresh.fetchedAt, new Date(later).toISOString());
  // Innsamlaren skriv over att når han er tilbake (nyare fetchedAt).
  const newer = { schema: 1, fetchedAt: new Date(later + 60_000).toISOString(), messages: [MSG] };
  assert.equal((await handle(req("/v1/trafikkmeldinger", { method: "POST", body: newer }), env, later + 60_000)).status, 204);
  const back = await (await handle(req("/v1/trafikkmeldinger"), env, later + 61_000, { fetchImpl: fjord1(calls) })).json();
  assert.equal(back.origin, "collector");
  // Fjord1 nede og gamle data: 200 med stale: true.
  const down = async () => new Response("nei", { status: 503 });
  const old = await (await handle(req("/v1/trafikkmeldinger"), env, later + 60 * 60_000, { fetchImpl: down })).json();
  assert.equal(old.stale, true);
  assert.equal(old.origin, "collector");
  // Ingen data og Fjord1 nede: 502.
  const emptyEnv = { DB: fakeD1(), COLLECTOR_KEY: KEY };
  assert.equal((await handle(req("/v1/trafikkmeldinger"), emptyEnv, T0, { fetchImpl: down })).status, 502);
});

test("reserven hentar frå Fjord1 maks éin gong i minuttet, òg ved feil", async () => {
  const env = { DB: fakeD1(), COLLECTOR_KEY: KEY };
  let n = 0;
  const down = async () => (n++, new Response("nei", { status: 503 }));
  assert.equal((await handle(req("/v1/trafikkmeldinger"), env, T0, { fetchImpl: down })).status, 502);
  assert.equal((await handle(req("/v1/trafikkmeldinger"), env, T0 + 30_000, { fetchImpl: down })).status, 502);
  assert.equal(n, 1, "feila forsøk tel òg");
  const calls = { n: 0 };
  const ok = await handle(req("/v1/trafikkmeldinger"), env, T0 + 61_000, { fetchImpl: fjord1(calls) });
  assert.equal(ok.status, 200);
  assert.equal(calls.n, 1);
  assert.ok(env.DB.raw.prepare("SELECT v FROM meta WHERE k = 'last:fjord1-fallback'").get());
});
