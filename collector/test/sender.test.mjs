import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { createSender, SENDER_KEY_HEADER } from "../src/sender.js";

test("avsendaren er av som standard og når URL eller nøkkel manglar", async () => {
  assert.equal(loadConfig({}).sender.enabled, false);
  assert.equal(loadConfig({ FERGERUTER_SENDER_ENABLED: "1" }).sender.enabled, false);
  assert.equal(loadConfig({ FERGERUTER_SENDER_ENABLED: "1", FERGERUTER_SENDER_URL: "https://x" }).sender.enabled, false);
  assert.equal(loadConfig({ FERGERUTER_SENDER_URL: "https://x", FERGERUTER_SENDER_KEY: "k" }).sender.enabled, false);
  let calls = 0;
  const s = createSender(loadConfig({ FERGERUTER_SENDER_ENABLED: "1" }).sender, { fetchImpl: async () => calls++ });
  assert.equal(s.enqueue({ kind: "sailed" }), false);
  assert.equal(await s.flush(), 0);
  assert.equal(await s.heartbeat({ health: "ok" }), false);
  assert.equal(calls, 0);
  assert.equal(s.status().enabled, false);
  assert.equal(s.status().requested, true);
});

test("påslått: POST med nøkkel i header, og nøkkelen er aldri i status", async () => {
  const cfg = loadConfig({ FERGERUTER_SENDER_ENABLED: "ja", FERGERUTER_SENDER_URL: "https://w.example/events/", FERGERUTER_SENDER_KEY: "hemmeleg" }).sender;
  const reqs = [];
  const s = createSender(cfg, { fetchImpl: async (url, init) => (reqs.push({ url, init }), new Response(null, { status: 204 })) });
  s.enqueue({ kind: "sailed", line: "1136" });
  assert.equal(await s.flush(), 1);
  assert.equal(reqs[0].url, "https://w.example/events/v1/events");
  assert.equal(reqs[0].init.method, "POST");
  assert.equal(reqs[0].init.headers[SENDER_KEY_HEADER], "hemmeleg");
  assert.deepEqual(JSON.parse(reqs[0].init.body).events, [{ kind: "sailed", line: "1136" }]);
  assert.equal(await s.heartbeat({ health: "ok", lines: {} }), true);
  assert.equal(reqs[1].url, "https://w.example/events/v1/heartbeat");
  assert.equal(reqs[1].init.headers[SENDER_KEY_HEADER], "hemmeleg");
  assert.doesNotMatch(JSON.stringify(s.status()), /hemmeleg|w\.example/);
});

test("feil frå workeren held hendingane i køa og gjev backoff", async () => {
  let clock = 0;
  const cfg = { enabled: true, url: "https://w", key: "k" };
  let calls = 0;
  const s = createSender(cfg, { now: () => clock, fetchImpl: async () => (calls++, new Response(null, { status: 503 })) });
  s.enqueue({ kind: "x" });
  assert.equal(await s.flush(), 0);
  assert.equal(await s.flush(), 0);
  assert.equal(calls, 1, "ingen nytt forsøk før backoff er ute");
  clock = 60000;
  await s.flush();
  assert.equal(calls, 2);
  assert.equal(s.status().queued, 1);
});

test("standardoppsett", () => {
  const c = loadConfig({});
  assert.deepEqual(c.lines, ["1136", "1135", "1049"]);
  assert.equal(c.dbPath, "/var/lib/fergeruter/collector.sqlite");
  assert.equal(c.retentionDays, 30);
  assert.equal(c.mode, "stream");
  assert.equal(c.httpPort, 8787);
});

test("Reviewer: usende hendingar frå databasen blir sende ved start, og sent_at blir sett", async () => {
  const { openDb } = await import("../src/db.js");
  const db = openDb(":memory:");
  const ev = { serviceDate: "2026-10-09", line: "1136", kind: "sailed", at: Date.parse("2026-10-09T08:00:00Z"), journeyRef: "MOR:ServiceJourney:1", stop: "Standal" };
  db.insertEvent(ev);
  db.insertEvent({ ...ev, journeyRef: "MOR:ServiceJourney:2" });
  assert.equal(db.unsentEvents().length, 2);
  const bodies = [];
  const s = createSender(
    { enabled: true, url: "https://w", key: "k" },
    { fetchImpl: async (url, init) => (bodies.push(JSON.parse(init.body)), new Response(null, { status: 204 })), onSent: (keys, at) => db.markSent(keys, at) }
  );
  for (const { key, event } of db.unsentEvents()) s.enqueue(event, key);
  assert.equal(s.enqueue(db.unsentEvents()[0].event, db.unsentEvents()[0].key), false, "ingen dobbel i køa");
  assert.equal(await s.flush(), 2);
  assert.equal(bodies[0].events[0].journeyRef, "MOR:ServiceJourney:1");
  assert.equal(bodies[0].events[0].at, "2026-10-09T08:00:00.000Z");
  assert.equal(db.unsentEvents().length, 0);
  db.close();
});

// --- AIS-posisjonar til workeren (POST /v1/positions) ---

const aisLive = (over = {}) => ({
  line: "1136", vehicleId: "mmsi:257297400", source: "ais", latitude: 62.2607, longitude: 6.5005,
  recordedAt: "2026-10-09T17:00:00+00:00", speedKn: 0, courseDeg: 44.4, heading: 22, navStatus: 0, name: "KVERNES", ...over,
});
function posSender(over = {}) {
  let clock = Date.parse("2026-10-09T17:00:05Z");
  const reqs = [];
  let respond = () => new Response(null, { status: 204 });
  const s = createSender({ enabled: true, url: "https://w.example", key: "hemmeleg" }, {
    now: () => clock,
    fetchImpl: async (url, init) => (reqs.push({ url, init, body: JSON.parse(init.body) }), respond()),
    ...over,
  });
  return { s, reqs, advance: (ms) => (clock += ms), setRespond: (fn) => (respond = fn), now: () => clock };
}

test("posisjonar: av som standard, ingen kall og ingenting hugsa", async () => {
  let calls = 0;
  const s = createSender({ enabled: false, url: "", key: "" }, { fetchImpl: async () => calls++ });
  assert.equal(s.enqueuePosition(aisLive()), false);
  assert.equal(await s.flushPositions(), 0);
  assert.equal(calls, 0);
});

test("posisjonar: første melding går med ein gong, med source ais og nøkkel i header", async () => {
  const { s, reqs } = posSender();
  assert.equal(s.enqueuePosition(aisLive()), true);
  assert.equal(await s.flushPositions(), 1);
  assert.equal(reqs[0].url, "https://w.example/v1/positions");
  assert.equal(reqs[0].init.headers[SENDER_KEY_HEADER], "hemmeleg");
  assert.equal(reqs[0].body.schema, 1);
  assert.deepEqual(reqs[0].body.positions[0], {
    mmsi: "257297400", line: "1136", name: "KVERNES", latitude: 62.2607, longitude: 6.5005, speedKn: 0,
    courseDeg: 44.4, heading: 22, navStatus: 0, msgtime: "2026-10-09T17:00:00.000Z", source: "ais",
  });
  assert.doesNotMatch(JSON.stringify(s.status()), /hemmeleg|w\.example/);
  assert.equal(s.status().positions.sent, 1);
});

test("posisjonar: berre siste melding per fartøy, og eldre melding blir ikkje sett inn", async () => {
  const { s, reqs } = posSender();
  s.enqueuePosition(aisLive({ recordedAt: "2026-10-09T17:00:10+00:00", latitude: 62.3 }));
  assert.equal(s.enqueuePosition(aisLive({ recordedAt: "2026-10-09T17:00:00+00:00", latitude: 62.1 })), false);
  s.enqueuePosition(aisLive({ recordedAt: "2026-10-09T17:00:20+00:00", latitude: 62.4 }));
  await s.flushPositions();
  assert.equal(reqs[0].body.positions.length, 1);
  assert.equal(reqs[0].body.positions[0].latitude, 62.4);
});

test("posisjonar: under fart kvart 15. s, ved kai kvart 60. s, aldri oftare enn 15 s mellom kall", async () => {
  const { s, reqs, advance } = posSender();
  const moving = (sec, lat) => aisLive({ recordedAt: new Date(Date.parse("2026-10-09T17:00:00Z") + sec * 1000).toISOString(), speedKn: 9, latitude: lat });
  s.enqueuePosition(moving(0, 62.2));
  assert.equal(await s.flushPositions(), 1);
  s.enqueuePosition(moving(5, 62.201));
  advance(5000);
  assert.equal(await s.flushPositions(), 0, "for tidleg (5 s)");
  advance(11000);
  assert.equal(await s.flushPositions(), 1, "16 s: under fart");
  // Ligg til kai: same stad, fart 0. Fyrste melding etter fart går raskt (skifte), resten kvart minutt.
  const still = (sec) => aisLive({ recordedAt: new Date(Date.parse("2026-10-09T17:00:00Z") + sec * 1000).toISOString(), speedKn: 0, latitude: 62.201 });
  s.enqueuePosition(still(30));
  advance(16000);
  assert.equal(await s.flushPositions(), 1, "skifte til kai");
  s.enqueuePosition(still(50));
  advance(30000);
  assert.equal(await s.flushPositions(), 0, "30 s ved kai: for tidleg");
  advance(31000);
  assert.equal(await s.flushPositions(), 1, "61 s ved kai");
  assert.equal(reqs.length, 4);
  s.enqueuePosition(still(50)); // same msgtime som alt sendt
  advance(120000);
  assert.equal(await s.flushPositions(), 0, "ingen ny melding, ingenting å sende");
});

test("posisjonar: flytta 30 m eller meir ved låg fart tel som i fart", async () => {
  const { s, reqs, advance } = posSender();
  s.enqueuePosition(aisLive({ recordedAt: "2026-10-09T17:00:00Z", speedKn: 0, latitude: 62.2 }));
  await s.flushPositions();
  s.enqueuePosition(aisLive({ recordedAt: "2026-10-09T17:00:20Z", speedKn: 0, latitude: 62.2004 })); // ~45 m
  advance(20000);
  assert.equal(await s.flushPositions(), 1);
  assert.equal(reqs.length, 2);
});

test("posisjonar: begge fartøya i eitt kall", async () => {
  const { s, reqs } = posSender();
  s.enqueuePosition(aisLive());
  s.enqueuePosition(aisLive({ line: "1135", vehicleId: "mmsi:257262400", name: "GEIRANGER" }));
  assert.equal(await s.flushPositions(), 2);
  assert.equal(reqs.length, 1);
  assert.deepEqual(reqs[0].body.positions.map((p) => p.line).sort(), ["1135", "1136"]);
});

test("posisjonar: 429 med Retry-After blir respektert, siste melding blir sendt etterpå", async () => {
  const { s, reqs, advance, setRespond } = posSender();
  setRespond(() => new Response(null, { status: 429, headers: { "Retry-After": "300" } }));
  s.enqueuePosition(aisLive({ speedKn: 9 }));
  assert.equal(await s.flushPositions(), 0);
  assert.equal(s.status().positions.failed, 1);
  assert.match(s.status().positions.lastError, /429/);
  setRespond(() => new Response(null, { status: 204 }));
  s.enqueuePosition(aisLive({ speedKn: 9, recordedAt: "2026-10-09T17:00:30Z", latitude: 62.3 }));
  advance(120000);
  assert.equal(await s.flushPositions(), 0, "framleis i Retry-After (300 s)");
  advance(190000);
  assert.equal(await s.flushPositions(), 1);
  assert.equal(reqs.length, 2);
  assert.equal(reqs[1].body.positions[0].latitude, 62.3, "den nyaste, ikkje den som feila");
  assert.equal(s.status().positions.lastError, null);
});

test("posisjonar: feil på posisjonar stoppar ikkje hendingar og puls", async () => {
  const { s, advance, setRespond } = posSender();
  setRespond((url) => new Response(null, { status: 500 }));
  s.enqueuePosition(aisLive());
  await s.flushPositions();
  setRespond(() => new Response(null, { status: 204 }));
  s.enqueue({ kind: "sailed" });
  assert.equal(await s.flush(), 1);
  assert.equal(await s.heartbeat({ health: "ok", lines: {} }), true);
  advance(1000);
});

test("posisjonar: ugyldige meldingar blir ikkje hugsa", () => {
  const { s } = posSender();
  assert.equal(s.enqueuePosition(aisLive({ vehicleId: "1136" })), false);
  assert.equal(s.enqueuePosition(aisLive({ recordedAt: "ikkje tid" })), false);
  assert.equal(s.enqueuePosition(aisLive({ latitude: null })), false);
  assert.equal(s.status().positions.pending, 0);
});
