import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import worker, {
  ERROR_CACHE_SECONDS,
  MESSAGES_API_URL,
  buildPayload,
  contentIdToMessageId,
  fetchMessages,
  handleRequest,
  nodeFromContent,
} from "../cloudflare/trafikkmeldinger/src/index.js";

function field(ident, value) {
  return { fieldDefinitionIdentifier: ident, fieldValue: value };
}

function content(id, { content2 = { xml: "<section>ikkje bruk</section>" } } = {}) {
  return {
    _id: id,
    CurrentVersion: {
      Version: {
        Fields: {
          field: [
            field("heading", "Standal-Trandal-Valderøya-Store Kalvøy"),
            field("county_number", 15),
            field("connection_number", 132),
            field("date", "24.08.2026 12:46:06"),
            field("content", "Rute 1136: normal drift."),
            field("content2", content2),
            field("important_message", false),
            field("valid_from", { timestamp: 1787568366 }),
            field("valid_to", { timestamp: 1787654704 }),
          ],
        },
      },
    },
  };
}

function view(hits, count = hits.length) {
  const searchHit = hits.length === 1 ? hits[0] : hits;
  return {
    View: {
      Result: {
        count,
        searchHits: { searchHit },
      },
    },
  };
}

function hit(id) {
  return { value: { Content: content(id) } };
}

test("id-formatet er det same som Python-skriptet", () => {
  assert.equal(contentIdToMessageId(21874418), "RG9tYWluQ29udGVudDoyMTg3NDQxOA==");
});

test("nodar hoppar over content2 og bruker plain content", () => {
  const node = nodeFromContent(content(21870001));
  assert.equal(node.id, contentIdToMessageId(21870001));
  assert.equal(node.content, "Rute 1136: normal drift.");
  assert.equal(node.connectionNumber, 132);
  assert.deepEqual(node.validFrom, { timestamp: 1787568366 });
  assert.equal(JSON.stringify(node).includes("ikkje bruk"), false);
});

test("hentinga bladrar og godtek éin treff som objekt", async () => {
  const calls = [];
  const messages = await fetchMessages({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const body = JSON.parse(init.body);
      const offset = body.ViewInput.Query.offset;
      assert.equal(body.ViewInput.Query.limit, 50);
      assert.equal(url, "https://www.fjord1.no/api/ezp/v2/views");
      const ids = [];
      for (let id = offset + 1; id <= Math.min(offset + 50, 51); id += 1) ids.push(id);
      return {
        ok: true,
        json: async () => view(ids.map(hit), 51),
      };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(messages.length, 51);
  assert.equal(messages[50].id, contentIdToMessageId(51));
  assert.equal(calls.some((call) => String(call.url).includes("graphql")), false);
});

test("GET svarar JSON med CORS og bruker cachen", async () => {
  const store = new Map();
  let upstream = 0;
  const cache = {
    async match(request) {
      return store.get(request.url) || null;
    },
    async put(request, response) {
      store.set(request.url, response);
    },
  };
  const fetchImpl = async () => {
    upstream += 1;
    return { ok: true, json: async () => view([hit(7)]) };
  };
  const now = () => new Date("2026-10-05T12:00:00.000Z");
  const first = await handleRequest(new Request("https://fergeruter-trafikkmeldinger.fergeruter-teitrand.workers.dev/"), {
    fetchImpl,
    cache,
    now,
  });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("access-control-allow-origin"), "*");
  assert.equal(first.headers.get("cache-control"), "public, max-age=120");
  const payload = await first.json();
  assert.equal(payload.complete, true);
  assert.equal(payload.fetchedAt, "2026-10-05T12:00:00.000Z");
  assert.equal(payload.source, "https://www.fjord1.no/trafikkmeldingar");
  assert.equal(payload.messages.length, 1);
  assert.deepEqual(payload, buildPayload(payload.messages, payload.fetchedAt));

  const second = await handleRequest(
    new Request("https://fergeruter-trafikkmeldinger.fergeruter-teitrand.workers.dev/?t=1"),
    { fetchImpl, cache, now }
  );
  assert.equal(upstream, 1);
  assert.equal((await second.json()).messages[0].id, contentIdToMessageId(7));
});

test("feil frå Fjord1 blir 502 og blir ståande ein kort stund", async () => {
  const store = new Map();
  let upstream = 0;
  const cache = {
    async match(request) {
      return store.get(request.url) || null;
    },
    async put(request, response) {
      store.set(request.url, response);
    },
  };
  const fetchImpl = async () => {
    upstream += 1;
    return {
      ok: true,
      json: async () => ({ ErrorMessage: { errorMessage: "nei" } }),
    };
  };
  const response = await handleRequest(new Request("https://example.test/"), { fetchImpl, cache });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), `public, max-age=${ERROR_CACHE_SECONDS}`);
  assert.ok(ERROR_CACHE_SECONDS >= 30 && ERROR_CACHE_SECONDS <= 60);
  assert.match((await response.json()).error, /nei/);
  assert.equal(store.size, 1);

  const again = await handleRequest(new Request("https://example.test/?t=1"), { fetchImpl, cache });
  assert.equal(again.status, 502);
  assert.equal(upstream, 1);
  assert.match((await again.json()).error, /nei/);
});

test("OPTIONS og POST", async () => {
  const options = await handleRequest(new Request("https://example.test/", { method: "OPTIONS" }), {
    fetchImpl: async () => {
      throw new Error("skal ikkje hente");
    },
  });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), "*");
  const post = await handleRequest(new Request("https://example.test/", { method: "POST" }));
  assert.equal(post.status, 405);
});

test("workeren startar ikkje GitHub-workflowen", () => {
  const toml = readFileSync(new URL("../cloudflare/trafikkmeldinger/wrangler.toml", import.meta.url), "utf8");
  const source = readFileSync(new URL("../cloudflare/trafikkmeldinger/src/index.js", import.meta.url), "utf8");
  // Klientkoden for trafikkmeldingar ligg i packages/core/messages.js (felles for vanilla og React).
  const app = readFileSync(new URL("../packages/core/messages.js", import.meta.url), "utf8");
  assert.match(toml, /crons = \[\]/);
  assert.equal(source.includes("workflow_dispatch"), false);
  assert.equal(source.includes("api.github.com"), false);
  assert.equal(worker.scheduled, undefined);
  assert.equal(app.includes(MESSAGES_API_URL), true);
  assert.match(app, /fetchFjord1Api\(fetchImpl, url = FJORD1_MESSAGES_API\)[\s\S]*?fetchWithTimeout\(\s*fetchImpl,\s*url,[\s\S]*?5000\s*\)/);
  assert.equal(app.includes("www.fjord1.no/graphql"), false);
  assert.equal(app.includes("FJORD1_GRAPHQL"), false);
});
