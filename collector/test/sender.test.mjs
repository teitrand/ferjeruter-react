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
  assert.deepEqual(c.lines, ["1136", "1135"]);
  assert.equal(c.dbPath, "/var/lib/fergeruter/collector.sqlite");
  assert.equal(c.retentionDays, 30);
  assert.equal(c.mode, "stream");
  assert.equal(c.httpPort, 8787);
});
