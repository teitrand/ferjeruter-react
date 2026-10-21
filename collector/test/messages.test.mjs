import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { createMessagesPusher } from "../src/messages.js";

const fjord1 = async () =>
  new Response(JSON.stringify({ View: { Result: { count: 1, searchHits: { searchHit: [
    { value: { Content: { _id: 1, CurrentVersion: { Version: { Fields: { field: [
      { fieldDefinitionIdentifier: "heading", fieldValue: "Standal-Trandal-Valderøya-Store Kalvøy" },
      { fieldDefinitionIdentifier: "content", fieldValue: "Rute 1136: normal drift" },
    ] } } } } } },
  ] } } } }));

test("innsamlaren hentar Fjord1-meldingar og POSTar dei til workeren med fetchedAt", async () => {
  const posts = [];
  const sender = { enabled: true, post: async (path, body) => (posts.push({ path, body }), new Response(null, { status: 204 })) };
  const p = createMessagesPusher(sender, { fetchImpl: fjord1, now: () => Date.parse("2026-10-21T09:00:00Z") });
  assert.equal(await p.tick(), true);
  assert.equal(posts[0].path, "/v1/trafikkmeldinger");
  assert.equal(posts[0].body.schema, 1);
  assert.equal(posts[0].body.fetchedAt, "2026-10-21T09:00:00.000Z");
  assert.equal(posts[0].body.messages.length, 1);
  assert.equal(p.status().local, 1);
});

test("av når avsendaren er av, eller FERGERUTER_MESSAGES_ENABLED=0; feil gjev backoff, ikkje krasj", async () => {
  assert.equal(loadConfig({}).messages.enabled, true);
  assert.equal(loadConfig({ FERGERUTER_MESSAGES_ENABLED: "0" }).messages.enabled, false);
  let calls = 0;
  const off = createMessagesPusher({ enabled: false, post: async () => calls++ }, { fetchImpl: fjord1 });
  assert.equal(await off.tick(), false);
  assert.equal(calls, 0);
  let t = 0;
  const bad = createMessagesPusher({ enabled: true, post: async () => new Response(null, { status: 500 }) }, { fetchImpl: fjord1, now: () => t });
  assert.equal(await bad.tick(), false);
  assert.equal(bad.status().failed, 1);
  assert.match(bad.status().lastError, /500/);
  assert.equal(await bad.tick(), false, "backoff: ingen nytt forsøk med ein gong");
  assert.equal(bad.status().failed, 1);
});
