// Testar for React-skalet i web/ som ikkje treng node_modules: modellen (web/src/model),
// UI-reduceren, Vite-tillegget for ?v= og byggjeskriptet for service workeren.
// Køyrer via test_status.mjs, sidan arbeidsflyta listar testfilene ein og ein.
// Sjølve React-teikninga blir testa i web/tests (npm test -w web).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as app from "../assets/app.js";
import * as core from "../packages/core/index.js";
import { LIVE_MIN_INTERVAL_MS, SAILED_KEY, departureStateKey, loadEnturEvidence, parseVehicleMonitoring } from "../packages/core/index.js";
import { stripVersionQuery } from "../web/build/strip-version-query.js";
import { HEAD_LINKS, pwaFiles, shellManifest } from "../web/build/pwa-assets.js";
import { dataUrls, renderServiceWorker } from "../web/scripts/build-sw.mjs";
import { serviceWorkerUrls } from "../web/src/pwa/register.js";
import { noindexUnlessRoot } from "../web/build/noindex.js";
import { memoryOnly, planContext, rememberBookings, statusEvidence } from "../web/src/model/context.js";
import { dataBase, fetchAppData, liveDataBase, mergeLoaded } from "../web/src/model/data.js";
import { connectionModel, detailModel, messagesModel, placeFilterModel, staleChoices } from "../web/src/model/controls.js";
import { emptyEntur, enturDue, enturReducer, enturRequest, rememberEntur, withEntur } from "../web/src/model/entur.js";
import { footnoteModel, ledeModel, routeChrome } from "../web/src/model/header.js";
import {
  LAST_MODE_KEY,
  TIMETABLE_CACHE_KEY,
  browserMemory,
  messageCache,
  readLastMode,
  timetableCache,
  writeLastMode,
} from "../web/src/model/storage.js";
import { buildTimeline } from "../web/src/model/timeline.js";
import { actionEvent, track as trackShell, visitEvents } from "../web/src/model/track.js";
import { initialUi, uiReducer } from "../web/src/state.js";
import { DAYS, LOG, ROUTES, VM_2030, osloMs } from "./helpers/replay.mjs";
import { appVersion } from "./helpers/version.mjs";

const { setLang } = await import(`../assets/i18n.js?v=${appVersion()}`);
const KOMBI = JSON.parse(readFileSync(new URL("../data/kombirute.json", import.meta.url), "utf8"));
const CONNECTIONS = JSON.parse(readFileSync(new URL("../data/korrespondanse.json", import.meta.url), "utf8"));

const RealDate = Date;
function atOslo(day, minutes, fn) {
  const fixed = osloMs(day, minutes);
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed;
    }
  };
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Det vanilla-appen viser for kvar avgang den dagen: klokke, strekning og status. */
function vanillaRows(date, today, now) {
  const rows = [];
  const seen = new Set();
  for (const leg of app.legsForDate(date)) {
    const key = `${leg.from}|${leg.departure}`;
    if (leg.hideDeparture || seen.has(key)) continue;
    seen.add(key);
    const status = app.tripStatusFor(leg);
    const signalDone = leg.signal && today && status.verdict === "skipped";
    const done = signalDone ? leg.departure : leg.arrival || leg.departure;
    const toMin = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
    const past = today && toMin(done) <= now;
    const departed = today && now >= toMin(leg.departure);
    rows.push(`${leg.departure.slice(0, 5)} ${leg.from}–${leg.to}${past ? " (tidlegare)" : ""}: ${departureStateKey(status, { past, departed, today })}`);
  }
  return rows;
}

function modelRows(timeline) {
  return timeline.rows
    .filter((row) => row.kind === "dep")
    .map((row) => `${row.time} ${row.from}–${row.to}${row.past ? " (tidlegare)" : ""}: ${row.state}`);
}

test("web-modellen gjev same avgangar og status som vanilla-appen, 2.–8. oktober", () => {
  setLang("nn", { persist: false });
  let compared = 0;
  let unknown = 0;
  let notRunning = 0;
  for (const day of DAYS) {
    // Avlyst hos Entur = «skipped» i loggen, som i replayen. Då blir signalturen «ikkje utført».
    const cancelledJourneys = new Set(LOG.days[day].filter((entry) => entry.status === "skipped").map((entry) => entry.id));
    for (let minutes = 6 * 60; minutes < 24 * 60; minutes += 47) {
      atOslo(day, minutes, () => {
        const signalLog = { days: { [day]: LOG.days[day] } };
        app.resetTestState();
        app.setTestState({ routes: ROUTES, kombirute: null, messages: null, routeChoice: "1136", signalLog, cancelledJourneys, date: null });
        const data = { routes: ROUTES, kombirute: null, messages: null, signalLog, cancelledJourneys };
        const ui = { ...initialUi(), showPast: true };
        const timeline = buildTimeline(data, ui, memoryOnly(), { now: minutes });
        const expected = vanillaRows(day, true, minutes);
        assert.deepEqual(modelRows(timeline), expected, `${day} kl. ${clock(minutes)}`);
        compared += expected.length;
        unknown += expected.filter((row) => row.endsWith(": unknown")).length;
        notRunning += expected.filter((row) => row.endsWith(": notRunning")).length;
        // Statuslinja: same tekst som currentStatus i vanilla-appen.
        const lede = ledeModel(data, ui, memoryOnly(), minutes);
        const status = app.currentStatus(app.legsForDate(day));
        assert.equal(lede.status, status ? status.short || status.text.replace(/\.$/, "") : null);
      });
    }
  }
  assert.ok(compared > 1000, `samanlikna ${compared} rader`);
  assert.ok(unknown > 0, "minst éin «Ukjent»-rad");
  assert.ok(notRunning > 0, "minst éin «Ikkje utført»-rad");
  app.resetTestState();
});

test("web-modellen: kombirute og ein annan dag gjev same rader som vanilla-appen", () => {
  setLang("en", { persist: false });
  try {
    atOslo("2026-10-08", 9 * 60, () => {
      for (const date of [null, "2026-10-09", "2026-10-07"]) {
        app.resetTestState();
        app.setTestState({ routes: ROUTES, kombirute: KOMBI, messages: null, routeChoice: "1136", date });
        const realLocation = globalThis.location;
        globalThis.location = { hostname: "localhost", pathname: "/", href: "http://localhost/?rute=kombi" };
        try {
          const data = { routes: ROUTES, kombirute: KOMBI, messages: null, signalLog: null };
          const ui = { ...initialUi({ override: "kombi", date }), showPast: true };
          assert.equal(routeChrome(data, ui).mode, "kombi");
          const timeline = buildTimeline(data, ui, memoryOnly(), { now: 9 * 60 });
          const day = date || "2026-10-08";
          assert.deepEqual(modelRows(timeline), vanillaRows(day, date === null, 9 * 60), `kombi ${day}`);
        } finally {
          globalThis.location = realLocation;
        }
      }
    });
  } finally {
    setLang("nn", { persist: false });
    app.resetTestState();
  }
});

test("web-modellen: tom data og dag utan turar", () => {
  const empty = buildTimeline({ routes: null, kombirute: null }, initialUi(), memoryOnly());
  assert.equal(empty.empty, "empty.noTimetable");
  const none = buildTimeline({ routes: { lines: {} }, kombirute: null }, initialUi({ date: "2026-10-08" }), memoryOnly());
  assert.equal(none.empty, "empty.noTripsDay");
});

test("web-modellen: ev og ctx har same felt som i vanilla-appen", () => {
  const data = { routes: ROUTES, kombirute: null, messages: null, signalLog: null };
  const ui = initialUi({ routeChoice: "1135", date: "2026-10-08" });
  const ctx = planContext(data, ui, 0);
  assert.deepEqual(Object.keys(ctx).sort(), ["date", "fromQuery", "kombirute", "messages", "nowMs", "override", "routeChoice", "routes", "today"]);
  assert.equal(ctx.routeChoice, "1135");
  const ev = statusEvidence(data, ui, memoryOnly(), ctx);
  assert.deepEqual(
    Object.keys(Object.getOwnPropertyDescriptors(ev)).sort(),
    ["actualDepartures", "cancelledJourneys", "clockNow", "confirmedBooked", "date", "dateLegs", "dayLegs", "live", "log", "messageCancelled", "sailedJourneys", "today"]
  );
});

test("web: ?rute= berre på localhost og /dev/", () => {
  assert.equal(core.routeOverride({ hostname: "localhost", pathname: "/", href: "http://localhost/?rute=kombi" }), "kombi");
  assert.equal(core.routeOverride({ hostname: "x.github.io", pathname: "/fergeruter/dev/web/", href: "https://x.github.io/fergeruter/dev/web/?rute=1135" }), "1135");
  assert.equal(core.routeOverride({ hostname: "x.github.io", pathname: "/fergeruter/", href: "https://x.github.io/fergeruter/?rute=kombi" }), null);
  assert.equal(core.routeOverride({ hostname: "localhost", pathname: "/", href: "http://localhost/?rute=tull" }), null);
});

test("web: UI-reduceren", () => {
  let ui = initialUi();
  assert.equal(uiReducer(ui, { type: "route", route: "1136" }), ui, "same samband gjev same objekt");
  ui = uiReducer(ui, { type: "route", route: "1135" });
  assert.equal(ui.routeChoice, "1135");
  assert.equal(uiReducer(ui, { type: "route", route: "kombi" }).routeChoice, "1136", "kombi kan ikkje veljast");
  ui = uiReducer({ ...ui, showPast: true, date: "2026-10-08" }, { type: "day", days: 1 });
  assert.deepEqual([ui.date, ui.showPast], ["2026-10-09", false]);
  assert.equal(uiReducer(ui, { type: "lang", lang: "en" }).lang, "en");
  assert.equal(uiReducer(ui, { type: "togglePast" }).showPast, true);
  assert.throws(() => uiReducer(ui, { type: "tull" }));
});

test("web: datakjelde og henting", async () => {
  assert.equal(dataBase({}), "./data/");
  assert.equal(dataBase({ VITE_DATA_BASE: "../data" }), "../data/");
  const asked = [];
  const files = { "x/ruter.json": ROUTES, "x/signalturar.json": { days: {} } };
  const fakeFetch = async (url) => {
    asked.push(url);
    return url in files ? { ok: true, json: async () => files[url] } : { ok: false, status: 404 };
  };
  const loaded = await fetchAppData(fakeFetch, "x/");
  assert.equal(loaded.routes, ROUTES);
  assert.equal(loaded.kombirute, null);
  assert.equal(loaded.messages, null);
  assert.deepEqual(loaded.signalLog, { days: {} });
  assert.equal(loaded.connections, null);
  assert.deepEqual(asked.sort(), [
    "x/kombirute.json",
    "x/korrespondanse.json",
    "x/ruter.json",
    "x/signalturar.json",
    "x/trafikkmeldinger.json",
  ]);
  await assert.rejects(fetchAppData(async () => ({ ok: false, status: 500 }), "y/"));
});

test("web: Vite-tillegget fjernar berre ?v=<tal> på relative importar", async () => {
  const plugin = stripVersionQuery();
  const calls = [];
  const ctx = { resolve: async (source, importer, options) => (calls.push([source, importer, options.skipSelf]), { id: source }) };
  assert.deepEqual(await plugin.resolveId.call(ctx, "../../assets/i18n.js?v=81", "/r/packages/core/time.js", {}), { id: "../../assets/i18n.js" });
  assert.deepEqual(calls, [["../../assets/i18n.js", "/r/packages/core/time.js", true]]);
  assert.equal(await plugin.resolveId.call(ctx, "./time.js?raw", "/r/x.js", {}), null);
  assert.equal(await plugin.resolveId.call(ctx, "react?v=81", "/r/x.js", {}), null);
  assert.equal(await plugin.resolveId.call(ctx, "./time.js", "/r/x.js", {}), null);
});

test("web: service workeren for skalet har eigne cachar og eige scope", () => {
  const template = readFileSync(new URL("../web/pwa/sw-template.js", import.meta.url), "utf8");
  const data = dataUrls({ VITE_DATA_BASE: "https://teitrand.github.io/fergeruter/data" });
  const out = renderServiceWorker(template, { version: "abc123", files: ["assets/index-x.js", "index.html", "icons/icon-192.png"], data });
  assert.match(out, /const CACHE = "fergeruter-web-abc123";/);
  assert.ok(out.includes('"./assets/index-x.js"') && out.includes('"./"') && out.includes('"./icons/icon-192.png"'));
  assert.ok(!out.includes("?v="), "ingen ?v= i precache");
  assert.ok(out.includes('"https://teitrand.github.io/fergeruter/data/ruter.json"'));
  assert.ok(out.includes('"https://teitrand.github.io/fergeruter/data/trafikkmeldinger.json"'));
  const isOwnCache = new Function(`${out.match(/^function isOwnCache[\s\S]*?^\}$/m)[0]}\nreturn isOwnCache;`)();
  // CacheStorage er felles for teitrand.github.io: vanilla-cachane er ikkje våre.
  assert.equal(isOwnCache(`fergeruter-v${appVersion()}`), false);
  assert.equal(isOwnCache(`fergeruter-dev-v${appVersion()}`), false);
  assert.equal(isOwnCache("fergeruter-web-old"), true);
  // Og vanilla ryddar ikkje i våre (isOwnCache i sw.js til vanilla).
  const vanillaSw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  const vanillaOwn = (dev) =>
    new Function("self", `${vanillaSw.match(/^const IS_DEV.*$/m)[0]}\n${vanillaSw.match(/^function isOwnCache[\s\S]*?^\}$/m)[0]}\nreturn isOwnCache;`)({
      location: { pathname: dev ? "/fergeruter/dev/sw.js" : "/fergeruter/sw.js" },
    });
  for (const dev of [false, true]) assert.equal(vanillaOwn(dev)("fergeruter-web-abc123"), false);
  // Ingen Service-Worker-Allowed eller scope utover mappa.
  assert.doesNotMatch(out, /Service-Worker-Allowed|scope:/);
  assert.throws(() => renderServiceWorker("const X = 1;", { version: "x", files: [] }), /CACHE/);
});

test("web: dataUrls tek berre med datafiler utanfor byggjet", () => {
  assert.deepEqual(dataUrls({}), []);
  assert.deepEqual(dataUrls({ VITE_DATA_BASE: "./data/" }), []);
  const remote = dataUrls({ VITE_DATA_BASE: "https://x.test/data/" });
  assert.equal(remote.length, 5);
  const split = dataUrls({ VITE_DATA_BASE: "./data/", VITE_LIVE_DATA_BASE: "https://live.test/data" });
  assert.deepEqual(split, ["https://live.test/data/trafikkmeldinger.json", "https://live.test/data/signalturar.json"]);
});

/** Køyrer sw.js i ein sandkasse med falske cachar, fetch og klientar. */
async function swSandbox(out, { origin = "https://teitrand.github.io", scope = "/ferjeruter-react/" } = {}) {
  const stores = new Map();
  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const map = stores.get(name);
    const keyOf = (req) => (typeof req === "string" ? new URL(req, origin + scope).href : req.url);
    return {
      match: async (req) => map.get(keyOf(req))?.clone(),
      put: async (req, res) => void map.set(keyOf(req), res),
      addAll: async () => undefined,
      keys: async () => [...map.keys()],
    };
  };
  const listeners = {};
  const posted = [];
  let server = {};
  const self = {
    location: new URL(origin + scope + "sw.js"),
    addEventListener: (type, fn) => (listeners[type] = fn),
    skipWaiting: () => undefined,
    clients: { matchAll: async () => [{ postMessage: (data) => posted.push(data) }], claim: async () => undefined },
  };
  const caches = {
    open: async (name) => cacheFor(name),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    // caches.match leitar i alle cachar på opphavet (òg vanilla sine). Skalet skal aldri bruke han.
    match: async () => {
      throw new Error("caches.match søkjer i alle cachar på opphavet");
    },
  };
  const fetchImpl = async (req) => {
    const url = typeof req === "string" ? req : req.url;
    if (!(url in server)) throw new TypeError("offline");
    return new Response(server[url], { status: 200 });
  };
  new Function("self", "caches", "fetch", "Request", "Response", out)(self, caches, fetchImpl, Request, Response);
  const run = async (url) => {
    let responded = null;
    const waits = [];
    const request = new Request(url);
    listeners.fetch({ request, respondWith: (p) => (responded = p), waitUntil: (p) => waits.push(p) });
    const response = responded ? await responded : null;
    const body = response ? await response.text() : null; // sida les svaret
    await Promise.all(waits);
    return body;
  };
  const activate = async () => {
    const waits = [];
    listeners.activate({ waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  };
  return { run, activate, posted, setServer: (next) => (server = next), stores, cacheFor };
}

test("web: service workeren melder ny rutetabell sjølv når sida har lese den gamle", async () => {
  const template = readFileSync(new URL("../web/pwa/sw-template.js", import.meta.url), "utf8");
  const url = "https://teitrand.github.io/fergeruter/data/ruter.json";
  const out = renderServiceWorker(template, { version: "t", files: [], data: [url] });
  const sw = await swSandbox(out);
  sw.setServer({ [url]: '{"fetchedAt":"A"}' });
  assert.equal(await sw.run(url), '{"fetchedAt":"A"}');
  assert.deepEqual(sw.posted, [], "fyrste gong: ingenting å melde");
  sw.setServer({ [url]: '{"fetchedAt":"B"}' });
  assert.equal(await sw.run(url), '{"fetchedAt":"A"}', "stale-while-revalidate gjev den gamle fyrst");
  assert.deepEqual(sw.posted, [{ type: "timetable-updated" }]);
  assert.equal(await sw.run(url), '{"fetchedAt":"B"}');
  // Offline: cachen svarar.
  sw.setServer({});
  assert.equal(await sw.run(url), '{"fetchedAt":"B"}');
  // Andre opphav enn sida og datakjelda (Entur, Fjord1) går forbi.
  assert.equal(await sw.run("https://api.entur.io/realtime/v1/rest/vm"), null);
});

test("web: offline les service workeren berre sin eigen cache, aldri vanilla sin (fergeruter-dev-*)", async () => {
  const template = readFileSync(new URL("../web/pwa/sw-template.js", import.meta.url), "utf8");
  const url = "https://teitrand.github.io/fergeruter/data/ruter.json";
  const out = renderServiceWorker(template, { version: "t", files: [], data: [url] });
  const sw = await swSandbox(out);
  // Den gamle testappen har eigne, eldre data i ein cache på same opphav.
  await sw.cacheFor("fergeruter-dev-v84").put(url, new Response('{"fetchedAt":"2026-10-02"}'));
  await sw.cacheFor("fergeruter-v84").put(url, new Response('{"fetchedAt":"2026-10-01"}'));
  await sw.activate();
  assert.ok(sw.stores.has("fergeruter-dev-v84") && sw.stores.has("fergeruter-v84"), "rører ikkje vanilla sine cachar");
  // Offline og tom eigen cache: ingen data frå vanilla sin cache (nettlesaren får nettverksfeil,
  // og skalet brukar rutetabellen det sjølv har lagra).
  assert.equal(await sw.run(url), null);
  // Nyaste eigne ruter.json vinn offline.
  sw.setServer({ [url]: '{"fetchedAt":"2026-10-08"}' });
  assert.equal(await sw.run(url), '{"fetchedAt":"2026-10-08"}');
  sw.setServer({});
  assert.equal(await sw.run(`${url}?t=1`), '{"fetchedAt":"2026-10-08"}');
});

test("web: utan nett seier fotnoten «Fekk ikkje kontakt med Entur», òg når siste kall gjekk bra", async () => {
  const { isOnline } = await import("../web/src/hooks/useOnline.js");
  assert.equal(isOnline({ onLine: false }), false);
  assert.equal(isOnline({ onLine: true }), true);
  assert.equal(isOnline(null), true, "ukjent = på nett, som før");
  const data = { routes: ROUTES, kombirute: null };
  const entur = { ...emptyEntur(), live: null, liveFailed: false };
  const online = withEntur(data, entur);
  const offline = withEntur(data, entur, { offline: true });
  assert.equal(online.liveFailed, false);
  assert.equal(offline.liveFailed, true);
  assert.equal(footnoteModel(online, initialUi(), null).position, "position.planned");
  assert.equal(footnoteModel(offline, initialUi(), null).position, "position.offline");
  // Same i kombi og 1136.
  for (const route of ["1136", "kombi"]) {
    const ui = { ...initialUi(), routeChoice: route, override: route === "kombi" ? "kombi" : null };
    assert.equal(footnoteModel({ ...offline, kombirute: KOMBI }, ui, null).position, "position.offline", route);
  }
});

test("web: manifest og ikon for skalet kjem frå vanilla-filene", () => {
  const manifest = JSON.parse(shellManifest());
  const vanilla = JSON.parse(readFileSync(new URL("../manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.name, vanilla.name);
  // Relativt: appen er mappa skalet ligg i, ikkje den gamle appen på /fergeruter/.
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.id, "./");
  assert.deepEqual(manifest.icons.map((icon) => icon.src), ["icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-192.png", "icons/icon-maskable-512.png"]);
  const files = pwaFiles();
  for (const icon of manifest.icons) assert.ok(files[icon.src]?.length > 100, icon.src);
  assert.ok(files["favicon.svg"] && files["icons/apple-touch-icon.png"]);
  for (const link of HEAD_LINKS) {
    assert.ok(!link.href.startsWith("/"), "relative lenkjer verkar under /ferjeruter-react/ og i rota");
    assert.ok(files[link.href], link.href);
  }
  assert.deepEqual(noindexUnlessRoot("/").transformIndexHtml(), []);
  assert.equal(noindexUnlessRoot("/ferjeruter-react/").transformIndexHtml()[0].attrs.content, "noindex");
});

test("web: index.html har tittel, metadata og noscript før JS", () => {
  const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>Fergeorakelet 1136 · Standal–Trandal<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]+">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Fergeorakelet">/);
  assert.match(html, /<meta name="mobile-web-app-capable" content="yes">/);
  assert.match(html, /<noscript>[\s\S]*href="https:\/\/www\.fjord1\.no\/trafikkmeldingar"[\s\S]*<\/noscript>/);
  assert.doesNotMatch(html, /name="robots"/, "noindex blir sett av byggjet, ikkje i kjelda");
});

test("web: sw.js blir registrert i mappa skalet ligg i", () => {
  assert.deepEqual(serviceWorkerUrls("/ferjeruter-react/", "https://teitrand.github.io/ferjeruter-react/?rute=kombi"), {
    url: "https://teitrand.github.io/ferjeruter-react/sw.js",
    scope: "/ferjeruter-react/",
  });
  assert.deepEqual(serviceWorkerUrls("/", "https://ruter.trandal.org/"), { url: "https://ruter.trandal.org/sw.js", scope: "/" });
  assert.deepEqual(serviceWorkerUrls("./", "http://localhost:4173/"), { url: "http://localhost:4173/sw.js", scope: "/" });
});

test("web: rutetabell-cache og siste samband har eigne nøklar", () => {
  const storage = fakeStorage();
  const cache = timetableCache(storage);
  assert.equal(cache.read(), null);
  cache.write({ routes: ROUTES, kombirute: KOMBI, connections: null });
  assert.equal(cache.read().routes.fetchedAt, ROUTES.fetchedAt);
  assert.equal(TIMETABLE_CACHE_KEY, "fergeruter-web-timetable-v1");
  assert.notEqual(TIMETABLE_CACHE_KEY, app.TIMETABLE_CACHE_KEY, "den gamle appen les ikkje skalet sin cache");
  assert.notEqual(LAST_MODE_KEY, app.LAST_MODE_KEY);
  assert.deepEqual(Object.keys(storage.data), [TIMETABLE_CACHE_KEY]);
  writeLastMode("kombi", storage, "2026-10-09");
  assert.equal(readLastMode(storage, "2026-10-09"), "kombi");
  assert.equal(readLastMode(storage, "2026-10-10"), null, "berre same dag");
  writeLastMode("tull", storage, "2026-10-09");
  assert.equal(readLastMode(storage, "2026-10-09"), "kombi");
  const broken = fakeStorage({ [TIMETABLE_CACHE_KEY]: "{", [LAST_MODE_KEY]: "x" });
  assert.equal(timetableCache(broken).read(), null);
  assert.equal(readLastMode(broken), null);
});

test("web: mergeLoaded held på objekta når ingenting er nytt", () => {
  const first = { routes: ROUTES, kombirute: KOMBI, connections: CONNECTIONS, messages: { fetchedAt: "x", messages: [] }, signalLog: null };
  const same = mergeLoaded(first, JSON.parse(JSON.stringify(first)));
  assert.equal(same.data, first, "same innhald gjev same objekt (inga omteikning)");
  assert.equal(same.timetableChanged, false);
  const newer = { ...JSON.parse(JSON.stringify(first)), routes: { ...ROUTES, fetchedAt: "2099-01-01T00:00:00Z" } };
  const changed = mergeLoaded(first, newer);
  assert.equal(changed.timetableChanged, true);
  assert.equal(changed.data.routes.fetchedAt, "2099-01-01T00:00:00Z");
  assert.equal(changed.data.messages, first.messages, "meldingane er like og blir ståande");
  const missing = mergeLoaded(first, { ...first, kombirute: null, connections: null, messages: null });
  assert.equal(missing.data, first, "valfrie filer som ikkje kom, tek ikkje bort dei vi har");
});

test("web: «vis tidlegare» held seg ved byte av språk og samband, ikkje ved ny dag (som vanilla)", () => {
  let ui = uiReducer(initialUi(), { type: "togglePast" });
  assert.equal(ui.showPast, true);
  ui = uiReducer(ui, { type: "lang", lang: "de" });
  assert.equal(ui.showPast, true);
  ui = uiReducer(ui, { type: "lang", lang: "en" });
  ui = uiReducer(ui, { type: "route", route: "1135" });
  assert.equal(ui.showPast, true);
  ui = uiReducer(ui, { type: "route", route: "1136" });
  assert.equal(ui.showPast, true);
  ui = uiReducer(ui, { type: "day", days: 1 });
  assert.equal(ui.showPast, false, "goToDay i vanilla lukkar lista");
});

test("web: fotnoten skil «ingen posisjon» frå «ingen kontakt» som vanilla", () => {
  for (const lang of ["nn", "en", "de"]) {
    setLang(lang, { persist: false });
    const data = { routes: ROUTES, kombirute: null, live: null };
    const planned = footnoteModel({ ...data, liveFailed: false }, initialUi(), null).position;
    const offline = footnoteModel({ ...data, liveFailed: true }, initialUi(), null).position;
    assert.equal(planned, "position.planned");
    assert.equal(offline, "position.offline");
    app.setTestState({ routes: ROUTES, live: null, liveFailed: true });
    assert.equal(app.positionNoteKey(), offline, `vanilla og skalet er like (${lang})`);
    app.setTestState({ liveFailed: false });
    assert.equal(app.positionNoteKey(), planned);
    app.resetTestState();
  }
  setLang("nn", { persist: false });
});

// --- Entur-bevis (5a) ----------------------------------------------------------------------

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
  };
}

/** Teikn til minnet ikkje endrar seg meir, slik App gjer med effekten og ny teikning. */
function settledTimeline(data, ui, memory, now) {
  for (let round = 0; round < 5; round += 1) {
    const timeline = buildTimeline(data, ui, memory, { now });
    if (!rememberBookings(memory, timeline.remember)) return timeline;
  }
  throw new Error("minnet roar seg ikkje");
}

test("timeline endrar ikkje minnet; rememberBookings legg inn det tripStatus bad om", () => {
  const memory = memoryOnly();
  assert.equal(rememberBookings(memory, [{ id: "a", booked: true }, { id: "b", booked: false }]), true);
  assert.deepEqual([...memory.confirmedBooked], ["a"]);
  assert.equal(rememberBookings(memory, [{ id: "a", booked: true }]), false);
  assert.equal(rememberBookings(memory, [{ id: "a", booked: false }]), true);
  assert.equal(memory.confirmedBooked.size, 0);
  assert.equal(rememberBookings(memory, undefined), false);

  // Ein signaltur Entur har faktisk avgang for, ber om å bli hugsa, men buildTimeline lèt minnet vere.
  atOslo("2026-10-08", 21 * 60, () => {
    const ev = new Map([[OUT_2000, "2026-10-08T20:00:03+02:00"]]);
    const data = { ...eveningData(), actualDepartures: ev };
    const fresh = memoryOnly();
    const timeline = buildTimeline(data, { ...initialUi(), showPast: true }, fresh, { now: 21 * 60 });
    assert.equal(fresh.confirmedBooked.size, 0);
    assert.ok(Array.isArray(timeline.remember));
  });
});

test("enturReducer: svar, backoff, avlysingar og byte av samband", () => {
  let state = enturReducer(emptyEntur(), { type: "start", at: 1000 });
  assert.equal(state.fetchedAt, 1000);
  const live = { journeyRef: "x" };
  const journeys = { cancelled: new Set(["c"]), actualDepartures: new Map([["d", "t"]]) };
  state = enturReducer(state, { type: "loaded", at: 2000, result: { live, liveError: null, journeys, journeysError: null } });
  assert.equal(state.live, live);
  assert.equal(state.liveFailed, false);
  assert.deepEqual([...state.cancelledJourneys], ["c"]);
  assert.equal(state.actualDepartures.get("d"), "t");
  assert.equal(state.journeysAt, 2000);

  // VM feilar: behald posisjonen, slå på backoff; Journey Planner feilar: behald avlysingane.
  const failed = enturReducer(state, {
    type: "loaded",
    at: 3000,
    result: { live: undefined, liveError: new Error("429"), journeys: null, journeysError: new Error("x") },
  });
  assert.equal(failed.live, live);
  assert.equal(failed.liveFailed, true);
  assert.ok(failed.backoffMs >= 60_000);
  assert.equal(failed.blockedUntil, 3000 + failed.backoffMs);
  assert.equal(failed.cancelledJourneys, state.cancelledJourneys);
  assert.equal(failed.journeysAt, 2000);
  const twice = enturReducer(failed, { type: "loaded", at: 4000, result: { live: undefined, liveError: new Error("429"), journeys: null } });
  assert.ok(twice.backoffMs > failed.backoffMs);
  const ok = enturReducer(twice, { type: "loaded", at: 5000, result: { live: null, liveError: null, journeys: null } });
  assert.deepEqual([ok.live, ok.liveFailed, ok.backoffMs, ok.blockedUntil], [null, false, 0, 0]);

  const reset = enturReducer(state, { type: "reset" });
  assert.deepEqual([reset.live, reset.fetchedAt], [null, 0]);
  assert.equal(reset.cancelledJourneys, state.cancelledJourneys);
  assert.throws(() => enturReducer(state, { type: "x" }), /ukjend/);
});

test("enturDue: driftsvindauge, 55 s mellom kall, backoff og gøymd fane", () => {
  const data = { routes: ROUTES, kombirute: null, messages: null, signalLog: null };
  const ui = initialUi({ date: "2026-10-10" });
  atOslo("2026-10-08", 12 * 60, () => {
    const now = Date.now();
    assert.equal(enturDue(emptyEntur(), data, ui, now), true, "vald dag påverkar ikkje");
    assert.equal(enturDue(emptyEntur(), data, ui, now, true), false);
    assert.equal(enturDue({ ...emptyEntur(), fetchedAt: now - LIVE_MIN_INTERVAL_MS + 1 }, data, ui, now), false);
    assert.equal(enturDue({ ...emptyEntur(), fetchedAt: now - LIVE_MIN_INTERVAL_MS }, data, ui, now), true);
    assert.equal(enturDue({ ...emptyEntur(), blockedUntil: now + 1 }, data, ui, now), false);
    assert.equal(enturDue(emptyEntur(), { routes: null, kombirute: null }, ui, now), false);
    const request = enturRequest(data, ui, ["Q"]);
    assert.equal(request.mode, "1136");
    assert.ok(request.todayLegs.length > 10);
    assert.deepEqual(request.quays, ["Q"]);
  });
  atOslo("2026-10-08", 3 * 60, () => {
    assert.equal(enturDue(emptyEntur(), data, initialUi(), Date.now()), false, "utanfor driftstida");
  });
});

test("loadEnturEvidence med falsk fetch gjev det reduceren treng", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push(options.method || "GET");
    const body = options.method === "POST" ? { data: {} } : VM_2030;
    return { ok: true, status: 200, statusText: "OK", json: async () => body };
  };
  const legs = atOslo("2026-10-08", 20 * 60 + 30, () => enturRequest(eveningData(), initialUi(), undefined).todayLegs);
  const result = await loadEnturEvidence(fetchImpl, { mode: "1136", todayLegs: legs });
  assert.equal(result.liveError, null);
  assert.equal(result.live.journeyRef, BACK_2020);
  assert.ok(result.journeys.cancelled instanceof Set);
  assert.ok(result.journeys.actualDepartures instanceof Map);
  assert.ok(calls.includes("POST") && calls.includes("GET"));
  const state = enturReducer(emptyEntur(), { type: "loaded", at: 1, result });
  assert.equal(state.live.journeyRef, BACK_2020);

  // Feil kastar aldri: VM-feil gjev liveError (posisjonen blir verande), JP-feil gjev journeysError.
  const broken = await loadEnturEvidence(
    async (url, options = {}) => {
      if (options.method === "POST") throw new TypeError("Failed to fetch");
      return { ok: false, status: 429, statusText: "429", json: async () => null };
    },
    { mode: "1136", todayLegs: legs }
  );
  assert.equal(broken.live, undefined);
  assert.ok(broken.liveError);
  assert.equal(broken.journeys, null);
  assert.ok(broken.journeysError instanceof TypeError);
});

// 8. oktober 20:30: Entur hadde 20:20-turen (1136_129) avlyst, men VM viste at ferja kom til
// Standal. 20:00-turen (1136_128) hadde faktisk avgang. Same scenario som i test_status.mjs.
const BACK_2020 = "MOR:ServiceJourney:1136_129_9150000046366348";
const OUT_2000 = "MOR:ServiceJourney:1136_128_9150000047474268";
const VM_LIVE = parseVehicleMonitoring(VM_2030);

function eveningData() {
  return { routes: ROUTES, kombirute: null, messages: null, signalLog: { days: { "2026-10-08": LOG.days["2026-10-08"] } } };
}

function eveningEntur(live) {
  return {
    ...emptyEntur(),
    live,
    cancelledJourneys: new Set([BACK_2020]),
    actualDepartures: new Map([[OUT_2000, "2026-10-08T20:00:03+02:00"]]),
    journeysAt: osloMs("2026-10-08", 20 * 60 + 30),
  };
}

test("web-modellen med Entur-bevis 8. oktober 20:30 gjev same rader som vanilla, òg etter at sanntida har gått ut", () => {
  setLang("nn", { persist: false });
  const storage = fakeStorage({ [SAILED_KEY]: JSON.stringify({ "2026-10-07": ["gammal"] }) });
  const memory = browserMemory(storage);
  const fresh = { ...VM_LIVE, validUntil: "2099-01-01T00:00:00Z" };
  const stale = { ...VM_LIVE, validUntil: "2000-01-01T00:00:00Z", recordedAt: "2000-01-01T00:00:00Z" };
  const ui = { ...initialUi(), showPast: true };
  // Vanilla legg turen inn i det same settet (sailedDate er i dag, så det blir ikkje lese på nytt).
  const vanillaSailed = new Set();
  const compare = (minutes, live, label) =>
    atOslo("2026-10-08", minutes, () => {
      const entur = eveningEntur(live);
      // Det App gjer i effekten etter eit Entur-svar.
      rememberEntur(memory, eveningData(), ui, entur, minutes);
      const data = withEntur(eveningData(), entur);
      const timeline = settledTimeline(data, ui, memory, minutes);
      app.resetTestState();
      app.setTestState({
        ...eveningData(),
        routeChoice: "1136",
        date: null,
        live,
        cancelledJourneys: entur.cancelledJourneys,
        actualDepartures: entur.actualDepartures,
        sailedJourneys: vanillaSailed,
        sailedDate: "2026-10-08",
        confirmedBooked: new Set(memory.confirmedBooked),
      });
      if (live) app.rememberLiveSailed(live, minutes, fakeStorage());
      const expected = vanillaRows("2026-10-08", true, minutes);
      assert.deepEqual(modelRows(timeline), expected, label);
      const status = app.currentStatus(app.legsForDate("2026-10-08"));
      assert.equal(ledeModel(data, ui, memory, minutes).status, status ? status.short || status.text.replace(/\.$/, "") : null, label);
      return modelRows(timeline);
    });
  try {
    const at2030 = compare(20 * 60 + 30, fresh, "20:30 med fersk sanntid");
    assert.ok(at2030.some((row) => row.startsWith("20:20") && row.endsWith(": gone")), at2030.join("\n"));
    // Turen er lagra med same nøkkel og form som vanilla-appen, og gamle dagar fell bort.
    assert.deepEqual(JSON.parse(storage.data[SAILED_KEY]), { "2026-10-08": [BACK_2020] });
    const later = compare(21 * 60, stale, "21:00 utan fersk sanntid");
    assert.ok(later.some((row) => row.startsWith("20:20") && row.endsWith(": gone")), later.join("\n"));
    // Ny økt les det lagra.
    assert.deepEqual([...browserMemory(storage).sailedJourneys("2026-10-08")], [BACK_2020]);
    // Motprøve utan signalloggen: då er det berre minnet om sanntida som gjer 20:20-turen «Gått».
    const noLog = withEntur({ ...eveningData(), signalLog: null }, eveningEntur(stale));
    const [kept, forgot] = atOslo("2026-10-08", 21 * 60, () => [
      modelRows(settledTimeline(noLog, ui, memory, 21 * 60)),
      modelRows(settledTimeline(noLog, ui, memoryOnly(), 21 * 60)),
    ]);
    assert.ok(kept.some((row) => row.startsWith("20:20") && row.endsWith(": gone")), kept.join("\n"));
    assert.ok(forgot.some((row) => row.startsWith("20:20") && !row.endsWith(": gone")), forgot.join("\n"));
  } finally {
    app.resetTestState();
  }
});

test("rememberEntur: bestilt når Entur har faktisk avgang i dag, gløymer avlyste, ikkje svar frå i går", () => {
  atOslo("2026-10-08", 21 * 60, () => {
    const ui = initialUi();
    const memory = memoryOnly();
    memory.confirmedBooked.add(BACK_2020);
    const entur = eveningEntur(null);
    assert.equal(rememberEntur(memory, eveningData(), ui, entur, 21 * 60), true);
    assert.equal(memory.confirmedBooked.has(BACK_2020), false, "avlyst");
    assert.equal(memory.confirmedBooked.has(OUT_2000), true, "faktisk avgang");
    assert.equal(rememberEntur(memory, eveningData(), ui, entur, 21 * 60), false, "ingen endring andre gongen");

    const yesterday = memoryOnly();
    const old = { ...entur, cancelledJourneys: new Set(), journeysAt: osloMs("2026-10-07", 23 * 60) };
    assert.equal(rememberEntur(yesterday, eveningData(), ui, old, 21 * 60), false);
    assert.equal(yesterday.confirmedBooked.size, 0);
  });
});

// --- 5b: frå/til, korrespondanse, ankomsttider, meldingar, detaljar ----------------------

/** Rader slik vanilla-appen vel dei i renderLive(): frå/til, korrespondanse, tidlegare. */
function vanillaTimeline(date, today, now) {
  const dayLegs = app.legsForDate(date);
  const legs = app.legsForPlaceFilter(date, dayLegs);
  const index = app.connectionIndex(date);
  const events = app.buildEvents(legs, index).filter((event) => app.matchesStop(event));
  const status = today ? app.currentStatus(dayLegs) : null;
  if (status) events.push({ at: status.at, kind: "status", status: true });
  events.sort(core.compareTimelineEvents);
  const rows = events
    .filter((event) => app.keepTimelineEvent(event, events, now, status))
    .map((event) => {
      const past = app.timelineEventIsPast(event, events, now) ? " (tidlegare)" : "";
      if (event.status) return "now";
      if (event.kind !== "dep") return `${event.kind} ${clock(event.at)}${past}`;
      const leg = event.leg;
      const notes = [core.journeyNote(leg, event.journey), app.connectionNote(index, "dep", leg), app.connectionNote(index, "arr", leg)];
      const status = app.tripStatusFor(leg);
      return [`dep ${leg.departure.slice(0, 5)} ${leg.from}–${leg.to}${past}${event.onward ? " vidare" : ""}`, ...(status.cancelled ? [] : notes.filter(Boolean))].join(" | ");
    });
  return { rows, pastCount: app.pastDepartureCount(events, now) };
}

function reactTimeline(timeline) {
  const rows = timeline.rows.map((row) => {
    const past = row.past ? " (tidlegare)" : "";
    if (row.kind === "now") return "now";
    if (row.kind !== "dep") return `${row.kind} ${row.time ?? clock(row.atMinutes ?? 0)}${past}`;
    return [`dep ${row.time} ${row.from}–${row.to}${past}${row.onward ? " vidare" : ""}`, ...[row.via, ...row.notes].filter(Boolean)].join(" | ");
  });
  return { rows, pastCount: timeline.pastCount };
}

test("web-modellen: frå/til, overgang og korrespondanse gjev same tidslinje som vanilla-appen", () => {
  setLang("nn", { persist: false });
  const T = (dest) => core.transferLineId(dest);
  const cases = [
    ["1136", { from: "Sæbø", to: null }, null],
    ["1136", { from: null, to: "Trandal" }, null],
    ["1136", { from: "Standal", to: "Trandal" }, null],
    ["1136", { from: "Standal", to: "Leknes" }, null],
    ["1136", { from: "Leknes", to: "Trandal" }, null],
    ["1136", { from: null, to: null }, "solavagen"],
    ["1136", { from: null, to: null }, "hundeidvika"],
    ["1136", { from: null, to: null }, T("Leknes")],
    ["1135", { from: null, to: null }, T("Trandal")],
    ["1135", { from: null, to: null }, T("Standal")],
    ["1135", { from: "Leknes", to: "Standal" }, T("Skår")],
    ["1135", { from: "Trandal", to: null }, null],
  ];
  let notes = 0;
  let onward = 0;
  try {
    for (const [route, filters, connection] of cases) {
      for (const [date, minutes] of [[null, 9 * 60], [null, 16 * 60 + 10], ["2026-10-09", 9 * 60]]) {
        atOslo("2026-10-08", minutes, () => {
          const signalLog = { days: { "2026-10-08": LOG.days["2026-10-08"] } };
          app.resetTestState();
          app.setTestState({
            routes: ROUTES,
            kombirute: null,
            messages: null,
            routeChoice: route,
            signalLog,
            date,
            showPast: false,
            fromFilter: filters.from,
            toFilter: filters.to,
            connection,
            connections: CONNECTIONS,
          });
          const data = { routes: ROUTES, kombirute: null, messages: null, signalLog, connections: CONNECTIONS };
          const ui = { ...initialUi({ routeChoice: route, date }), filters, connection };
          const label = `${route} ${JSON.stringify(filters)} ${connection} ${date || "i dag"} ${clock(minutes)}`;
          const expected = vanillaTimeline(date || "2026-10-08", date === null, minutes);
          const actual = reactTimeline(buildTimeline(data, ui, memoryOnly(), { now: minutes }));
          assert.deepEqual(actual.rows, expected.rows, label);
          assert.equal(actual.pastCount, expected.pastCount, label);
          notes += expected.rows.filter((row) => row.includes(" | ")).length;
          onward += expected.rows.filter((row) => row.includes(" vidare")).length;
        });
      }
    }
  } finally {
    app.resetTestState();
  }
  assert.ok(notes > 20, `rader med merknad: ${notes}`);
  assert.ok(onward > 0, "minst éi «vidare»-rad etter overgang");
});

test("web-modellen: ankomsttider av, liggetid med frå-filter og tomt frå/til-resultat", () => {
  setLang("nn", { persist: false });
  atOslo("2026-10-08", 9 * 60, () => {
    const data = { routes: ROUTES, kombirute: null, messages: null, signalLog: null, connections: CONNECTIONS };
    const shown = buildTimeline(data, { ...initialUi(), showPast: true }, memoryOnly());
    const hidden = buildTimeline(data, { ...initialUi(), showPast: true, hideArrivals: true }, memoryOnly());
    assert.ok(shown.rows.some((row) => row.kind === "dep" && row.arrival));
    assert.ok(hidden.rows.filter((row) => row.kind === "dep").every((row) => row.arrival === null));

    const all = buildTimeline(data, { ...initialUi(), showPast: true }, memoryOnly());
    const quay = all.rows.find((row) => row.kind === "layover")?.quay;
    assert.ok(quay, "minst éi liggetid");
    const fromQuay = buildTimeline(data, { ...initialUi(), showPast: true, filters: { from: quay, to: null } }, memoryOnly());
    const layovers = fromQuay.rows.filter((row) => row.kind === "layover");
    assert.ok(layovers.length && layovers.every((row) => row.named === false && row.quay === quay));
    assert.ok(all.rows.filter((row) => row.kind === "layover").every((row) => row.named === true));

    app.resetTestState();
    app.setTestState({ fromFilter: "Urke", toFilter: "Valderøya" });
    const none = buildTimeline(data, { ...initialUi(), filters: { from: "Urke", to: "Valderøya" } }, memoryOnly());
    assert.equal(none.emptyPlace, app.emptyPlaceMessage());
    assert.equal(none.emptyPlace, core.emptyPlaceMessage({ from: "Urke", to: "Valderøya" }));
    app.resetTestState();
  });
});

test("kontrollane: frå/til-val, korrespondanse-val og det som skal gløymast", () => {
  setLang("nn", { persist: false });
  atOslo("2026-10-08", 9 * 60, () => {
    const data = { routes: ROUTES, kombirute: null, messages: null, signalLog: null, connections: CONNECTIONS };
    const ui = { ...initialUi(), filters: { from: "Standal", to: null } };
    const place = placeFilterModel(data, ui);
    app.resetTestState();
    app.setTestState({ routes: ROUTES, routeChoice: "1136", date: null });
    assert.ok(place.quays.includes("Leknes"), "kaiar berre 1135 går til, er med");
    assert.equal(place.from.includes("Standal"), true);
    assert.equal(place.to.includes("Standal"), false, "frå-kaien er ikkje i til-lista");
    assert.equal(place.canSwap, true);
    assert.equal(placeFilterModel(data, initialUi()).canSwap, false);

    const conn = connectionModel(data, { ...initialUi(), connection: "solavagen" });
    assert.deepEqual(
      conn.lines.map((line) => line.id),
      app.visibleConnectionLines(app.legsForDate("2026-10-08")).map((line) => line.id)
    );
    assert.equal(conn.value, "solavagen");
    app.setTestState({ connection: "solavagen", connections: CONNECTIONS });
    assert.match(conn.footnote, /\S/);
    assert.equal(conn.footnote, core.connectionFootnote("solavagen", CONNECTIONS));

    // Ein kai som ikkje finst og eit korrespondanse-val som ikkje gjeld, blir gløymde.
    const bad = { ...initialUi(), filters: { from: "Nordpolen", to: "Trandal" }, connection: "oye" };
    const patch = staleChoices(bad, placeFilterModel(data, bad), connectionModel(data, bad), null);
    assert.deepEqual(patch, { filters: { from: null, to: "Trandal" }, connection: null });
    const fine = { ...ui, connection: "solavagen" };
    assert.equal(staleChoices(fine, placeFilterModel(data, fine), connectionModel(data, fine), null), null);
    app.resetTestState();
  });
});

test("web: reduceren for frå/til, ankomsttider, korrespondanse, meldingar og detaljar", () => {
  let ui = initialUi({ hideArrivals: true });
  assert.equal(ui.hideArrivals, true);
  ui = uiReducer(ui, { type: "from", value: "Sæbø" });
  ui = uiReducer(ui, { type: "to", value: "Trandal" });
  assert.deepEqual(ui.filters, { from: "Sæbø", to: "Trandal" });
  assert.equal(uiReducer(ui, { type: "from", value: "Sæbø" }), ui, "same val gjev same tilstand");
  ui = uiReducer(ui, { type: "swap" });
  assert.deepEqual(ui.filters, { from: "Trandal", to: "Sæbø" });
  assert.equal(uiReducer(initialUi(), { type: "swap" }).filters, initialUi().filters);
  assert.deepEqual(uiReducer(ui, { type: "route", route: "1135" }).filters, { from: null, to: null }, "nytt samband nullstiller frå/til");
  assert.deepEqual(uiReducer(ui, { type: "day", days: 1 }).filters, ui.filters, "ny dag held på frå/til");
  assert.equal(uiReducer(ui, { type: "toggleArrivals" }).hideArrivals, false);
  assert.equal(uiReducer(ui, { type: "connection", id: "solavagen" }).connection, "solavagen");
  assert.equal(uiReducer(ui, { type: "connection", id: "" }).connection, null);
  assert.equal(uiReducer(ui, { type: "messageFilter", filter: "route" }).messageFilter, "route");
  assert.equal(uiReducer(ui, { type: "toggleMessages" }).messagesExpanded, true);
  const leg = { from: "A" };
  assert.equal(uiReducer(ui, { type: "detail", leg }).detail, leg);
  assert.equal(uiReducer(ui, { type: "sanitize", patch: { connection: null } }), ui, "ingen endring, same tilstand");
  assert.equal(uiReducer(ui, { type: "sanitize", patch: { messageFilter: "route" } }).messageFilter, "route");
});

const MESSAGES = {
  fetchedAt: "2026-10-08T06:00:00Z",
  messages: [
    { id: "a", heading: "Standal–Trandal", text: "Forseinking på rute 1136.", severity: "delay", isLocal: true, publishedAt: "2026-10-08T05:00:00Z", connectionNumber: 132 },
    { id: "b", heading: "Sæbø–Leknes", text: "Innstilt avgang 1135.", severity: "cancelled", isLocal: true, publishedAt: "2026-10-08T05:30:00Z", connectionNumber: 134 },
    { id: "c", heading: "Anna samband", text: "Normal drift.", severity: "normal", isLocal: false, publishedAt: "2026-10-08T04:00:00Z" },
  ],
};

test("meldingspanelet: filter, rekkjefølgje og same svar som vanilla-appen", () => {
  setLang("nn", { persist: false });
  atOslo("2026-10-08", 9 * 60, () => {
    const now = Date.now();
    for (const route of ["1136", "1135"]) {
      for (const filter of ["local", "route"]) {
        app.resetTestState();
        app.setTestState({ routeChoice: route, messageFilter: filter });
        const all = core.validMessages(MESSAGES.messages, now);
        const panel = messagesModel({ messages: MESSAGES }, { ...initialUi({ routeChoice: route }), messageFilter: filter }, now);
        assert.equal(panel.hidden, false);
        assert.deepEqual(panel.filters, app.usefulMessageFilters(all, route));
        assert.deepEqual(panel.messages.map((msg) => msg.id), app.applyMessageFilter(all).map((msg) => msg.id), `${route} ${filter}`);
      }
    }
    const route1135 = messagesModel({ messages: MESSAGES }, { ...initialUi({ routeChoice: "1135" }), messageFilter: "route" }, now);
    assert.deepEqual(route1135.messages.map((msg) => msg.id), ["b"]);
    const local1136 = messagesModel({ messages: MESSAGES }, initialUi(), now);
    assert.deepEqual(local1136.messages.map((msg) => msg.id), ["a", "b"], "eige samband fyrst");
    assert.match(local1136.meta, /Henta|henta/);
    const noLocal = { ...MESSAGES, messages: [MESSAGES.messages[2]] };
    assert.equal(messagesModel({ messages: noLocal }, initialUi(), now).hidden, true);
    assert.equal(messagesModel({ messages: null }, initialUi(), now).hidden, true);
    app.resetTestState();
  });
});

test("meldingar: nextMessages held på same objekt når ingenting er nytt", () => {
  // Som applyIncomingMessages i vanilla: held-meldingar frå førre svar kan endre rekkjefølgja
  // fyrste gong; etter det gjev same svar same objekt.
  const first = core.nextMessages(core.nextMessages(null, MESSAGES), { ...MESSAGES });
  assert.equal(core.nextMessages(first, { ...MESSAGES }), first);
  const changed = { ...MESSAGES, messages: MESSAGES.messages.slice(0, 2) };
  assert.notEqual(core.nextMessages(first, changed), first);
  assert.equal(core.nextMessages(first, null), first);
});

test("meldingar frå Fjord1: workeren fyrst, så HTML-sida når workeren feilar", async () => {
  const asked = [];
  const workerOk = async (url) => {
    asked.push(url);
    return { ok: true, status: 200, json: async () => ({ fetchedAt: "2026-10-08T06:00:00Z", messages: [] }) };
  };
  const fromWorker = await core.fetchFjord1Messages(workerOk);
  assert.deepEqual(asked, [core.FJORD1_MESSAGES_API]);
  assert.ok(Array.isArray(fromWorker.messages));
  asked.length = 0;
  const workerDown = async (url) => {
    asked.push(url);
    if (url === core.FJORD1_MESSAGES_API) return { ok: false, status: 503, statusText: "503" };
    return { ok: true, status: 200, text: async () => "<html><body>ingen meldingar</body></html>" };
  };
  await assert.rejects(core.fetchFjord1Messages(workerDown), /Ingen Fjord1-meldingar/);
  assert.deepEqual(asked, [core.FJORD1_MESSAGES_API, core.FJORD1_HTML_READER]);
});

test("detaljvindauget: same tekst som vanilla-appen for vanleg tur og signaltur", () => {
  setLang("nn", { persist: false });
  atOslo("2026-10-08", 9 * 60, () => {
    const signalLog = { days: { "2026-10-08": LOG.days["2026-10-08"] } };
    const data = { routes: ROUTES, kombirute: null, messages: null, signalLog };
    app.resetTestState();
    app.setTestState({ routes: ROUTES, routeChoice: "1136", signalLog, date: null });
    const legs = app.legsForDate("2026-10-08");
    const regular = legs.find((leg) => !leg.signal);
    const signal = legs.filter((leg) => leg.signal);
    assert.ok(regular && signal.length > 2);
    for (const leg of [regular, ...signal]) {
      const react = detailModel(data, initialUi(), memoryOnly(), leg, 9 * 60);
      const vanilla = core.departureDetailContent(leg, app.departureDetail(leg, 9 * 60), { today: true, now: 9 * 60, ferry: { name: "Kvernes", source: "table" } });
      assert.deepEqual(react, vanilla, `${leg.departure} ${leg.from}`);
    }
    const content = detailModel(data, initialUi(), memoryOnly(), signal[signal.length - 1], 9 * 60);
    assert.match(content.title, /\d\d:\d\d/);
    assert.ok(content.paragraphs.some((item) => item.phone), "ringelenkje for signaltur");
    assert.ok(content.paragraphs.some((item) => item.className === "detail-status"));
    assert.equal(detailModel(data, initialUi(), memoryOnly(), null), null);
    app.resetTestState();
  });
});

test("enturReducer: eit treigt svar skriv ikkje over eit nyare; StrictMode gjev eitt kall", () => {
  const newer = enturReducer(emptyEntur(), {
    type: "loaded",
    at: 2000,
    startedAt: 1500,
    result: { live: { journeyRef: "ny" }, liveError: null, journeys: null },
  });
  const slow = enturReducer(newer, {
    type: "loaded",
    at: 2100,
    startedAt: 1000,
    result: { live: { journeyRef: "gammal" }, liveError: null, journeys: null },
  });
  assert.equal(slow, newer, "svaret frå kallet som starta 1000, blir kasta");
  assert.equal(slow.live.journeyRef, "ny");
  const later = enturReducer(newer, { type: "loaded", at: 3000, startedAt: 2500, result: { live: null, liveError: null, journeys: null } });
  assert.equal(later.live, null);
  assert.equal(later.answeredAt, 2500);

  // Hooken hugsar starttida i ein ref før dispatch; andre køyring ser henne og spør ikkje.
  const data = { routes: ROUTES, kombirute: null, messages: null, signalLog: null };
  atOslo("2026-10-08", 12 * 60, () => {
    const at = Date.now();
    assert.equal(enturDue(emptyEntur(), data, initialUi(), at), true, "fyrste køyring");
    assert.equal(enturDue({ ...emptyEntur(), fetchedAt: Math.max(0, at) }, data, initialUi(), at), false, "andre køyring i StrictMode");
  });
});

/** localStorage i minnet. */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test("avlyst signaltur framfor oss er «Avlyst», etter avgangstida «Ikkje utført» (nn/en/de, vanilla og React)", () => {
  // Entur har avlyst ein signaltur i dag (som når ingen har tinga innan fristen).
  const day = "2026-10-08";
  const toMin = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  app.resetTestState();
  app.setTestState({ routes: ROUTES, routeChoice: "1136", date: day });
  const leg = app.legsForDate(day).find((item) => item.signal && toMin(item.departure) > 12 * 60);
  assert.ok(leg, "signaltur 8. oktober");
  const cancelledJourneys = new Set([core.serviceJourneyId(leg.id)]);
  const signalLog = null;
  const data = { routes: ROUTES, kombirute: null, messages: null, signalLog, cancelledJourneys };
  const expected = { nn: ["Avlyst", "Ikkje utført"], en: ["Cancelled", "Not performed"], de: ["Abgesagt", "Nicht ausgeführt"] };
  let checked = 0;
  for (const [lang, [ahead, after]] of Object.entries(expected)) {
    setLang(lang, { persist: false });
    for (const [offset, text] of [[-7, ahead], [5, after]]) {
      const now = toMin(leg.departure) + offset;
      atOslo(day, now, () => {
        app.resetTestState();
        app.setTestState({ routes: ROUTES, routeChoice: "1136", signalLog, cancelledJourneys, date: null });
        const target = app.legsForDate(day).find((item) => item.departure === leg.departure && item.from === leg.from);
        const status = app.tripStatusFor(target);
        if (status.verdict !== "skipped") return;
        checked += 1;
        const timeline = buildTimeline(data, { ...initialUi(), showPast: true }, memoryOnly(), { now });
        const row = timeline.rows.find((item) => item.kind === "dep" && item.leg.departure === leg.departure && item.leg.from === leg.from);
        assert.equal(row.state, "notRunning", `${lang} ${offset}`);
        assert.equal(row.stateText, text, `React-rad ${lang} ${offset}`);
        // Vanilla brukar same core-funksjon på rada og i minuttoppdateringa.
        const past = offset > 0;
        assert.equal(core.departureStateText(row.state, target, { today: true, past, now }), text, `vanilla-rad ${lang} ${offset}`);
        const vanilla = core.departureDetailContent(target, app.departureDetail(target, now), { today: true, now, ferry: { name: "Kvernes", source: "table" } });
        const react = detailModel(data, initialUi(), memoryOnly(), target, now);
        assert.deepEqual(react, vanilla, `dialog ${lang} ${offset}`);
        assert.equal(react.paragraphs.find((item) => item.className === "detail-status").text, text, `dialog ${lang} ${offset}`);
      });
    }
  }
  assert.ok(checked >= 6, `minst éin avlyst signaltur før og etter avgang i alle språk (${checked})`);
  // Andre dagar enn i dag: alltid «Ikkje utført» (Entur-avlysingar gjeld berre i dag).
  setLang("nn", { persist: false });
  assert.equal(core.departureStateText("notRunning", { departure: "23:59" }, { today: false, now: 0 }), "Ikkje utført");
  assert.equal(core.cancelledAhead({ departure: "09:20" }, { today: true, now: 9 * 60 + 13 }), true);
  assert.equal(core.cancelledAhead({ departure: "09:20" }, { today: true, now: 9 * 60 + 20 }), false);
  assert.equal(core.cancelledAhead({ departure: "09:20" }, { today: true, past: true, now: 0 }), false);
  app.resetTestState();
});

test("meldingar: like meldingar med ny hentetid gjev ny «Sist henta», men same meldingsliste", () => {
  const first = core.nextMessages(core.nextMessages(null, MESSAGES), { ...MESSAGES });
  const later = { ...MESSAGES, fetchedAt: "2026-10-08T07:30:00Z", fetchedLive: true };
  const next = core.nextMessages(first, later);
  assert.notEqual(next, first, "nytt objekt så panelet teiknar ny tid");
  assert.equal(next.messages, first.messages, "same meldingsliste");
  assert.equal(next.fetchedAt, "2026-10-08T07:30:00Z");
  assert.equal(next.fetchedLive, true);
  assert.equal(core.nextMessages(next, { ...later }), next, "same tid på nytt: same objekt");
  setLang("nn", { persist: false });
  const panel = core.messagesPanel(next, "local", "1136", Date.parse("2026-10-08T08:00:00Z"));
  if (!panel.hidden) assert.match(panel.meta, /09:30/);
});

test("meldingar i localStorage: omlegging Fjord1 har fjerna, blir ståande etter omlasting", () => {
  const now = Date.parse("2026-10-08T10:00:00Z");
  const reroute = {
    id: "omlegging",
    heading: "Standal - Trandal - Sæbø",
    text: "Rute 1136: Kombinasjonsrute i dag.",
    publishedAt: "2026-10-08T05:00:00Z",
    validFrom: "2026-10-08T05:00:00Z",
    validTo: "2026-10-08T21:00:00Z",
    isLocal: true,
    severity: "info",
  };
  const other = { ...reroute, id: "anna", text: "Rute 1135: Normal drift.", publishedAt: "2026-10-08T06:00:00Z" };
  const storage = memoryStorage();
  const cache = messageCache(storage);
  assert.equal(cache.read(), null);
  cache.write({ fetchedAt: "2026-10-08T09:00:00Z", messages: [reroute, other] });
  // Omlasting: cachen er førre tilstand, nytt svar frå Fjord1 manglar omlegginga.
  const reloaded = cache.read();
  assert.equal(reloaded.messages.length, 2);
  const next = core.nextMessages(reloaded, { fetchedAt: "2026-10-08T10:00:00Z", messages: [other] }, now);
  assert.deepEqual(next.messages.map((msg) => msg.id).sort(), ["anna", "omlegging"]);
  // Same som vanilla: applyIncomingMessages held på det readCachedMessages() gav.
  assert.equal(core.MESSAGES_CACHE_KEY, app.MESSAGES_CACHE_KEY);
  app.writeCachedMessages({ fetchedAt: "x", messages: [reroute] }, storage);
  assert.deepEqual(cache.read().messages.map((msg) => msg.id), ["omlegging"]);
  storage.setItem(core.MESSAGES_CACHE_KEY, "{øydelagt");
  assert.equal(cache.read(), null);
  assert.equal(messageCache(null).read() ?? null, null);
});

test("Plausible: handlingane i skalet gjev same hendingar som vanilla-appen", () => {
  const source = readFileSync(new URL("../assets/app.js", import.meta.url), "utf8");
  const ui = { ...initialUi(), lang: "nn" };
  const leg = { departure: "10:00:00", signal: { minutesBefore: 60 } };
  const cases = [
    [{ type: "from", value: "Trandal" }, "From Trandal"],
    [{ type: "from", value: null }, null],
    [{ type: "to", value: null }, null],
    [{ type: "to", value: "Sæbø" }, "To Sæbø"],
    [{ type: "swap" }, null],
    [{ type: "route", route: "1135" }, "Route 1135"],
    [{ type: "route", route: "1136" }, null],
    [{ type: "toggleArrivals" }, "Hide arrivals"],
    [{ type: "connection", id: "solavagen" }, "Connection solavagen"],
    [{ type: "connection", id: null }, "Connection none"],
    [{ type: "messageFilter", filter: "route" }, "Messages route"],
    [{ type: "messageFilter", filter: "local" }, null],
    [{ type: "togglePast" }, "Show past"],
    [{ type: "day", days: -1 }, "Day prev"],
    [{ type: "day", days: 1 }, "Day next"],
    [{ type: "day", days: 0 }, "Day today"],
    [{ type: "lang", lang: "de" }, "Language de"],
    [{ type: "lang", lang: "nn" }, null],
    [{ type: "detail", leg }, "Departure detail"],
    [{ type: "detail", leg: null }, null],
    [{ type: "toggleMessages" }, null],
  ];
  for (const [action, name] of cases) assert.equal(actionEvent(action, ui)?.name ?? null, name, JSON.stringify(action));
  assert.equal(actionEvent({ type: "swap" }, { ...ui, filters: { from: "Trandal", to: null } }).name, "Swap direction");
  assert.equal(actionEvent({ type: "toggleArrivals" }, { ...ui, hideArrivals: true }).name, "Show arrivals");
  assert.equal(actionEvent({ type: "togglePast" }, { ...ui, showPast: true }).name, "Hide past");
  assert.deepEqual(actionEvent({ type: "detail", leg }, ui).props, { signal: "yes" });
  // Kvar hending finst i vanilla-appen (namna Plausible-måla byggjer på).
  for (const name of ["Swap direction", "Show arrivals", "Hide arrivals", "Show past", "Hide past", "Day prev", "Day next", "Day today", "Departure detail"]) {
    assert.ok(source.includes(`"${name}"`), name);
  }
  // Same eigenskapar som vanilla-track: språk, web/pwa og samband (det nye ved rutebyte).
  const calls = [];
  const win = { plausible: (name, opts) => calls.push({ name, opts }), matchMedia: () => ({ matches: false }) };
  const route = actionEvent({ type: "route", route: "1135" }, ui);
  trackShell(win, route.name, route.props, route.ui);
  trackShell(win, "Visit nn", null, ui, { interactive: false });
  trackShell(null, "Day next", null, ui);
  assert.deepEqual(calls, [
    { name: "Route 1135", opts: { props: { lang: "nn", app: "web", route: "saebo-leknes" } } },
    { name: "Visit nn", opts: { props: { lang: "nn", app: "web", route: "standal-trandal" }, interactive: false } },
  ]);
  const previous = globalThis.window;
  globalThis.window = { plausible: (name, opts) => calls.push({ name, opts }) };
  try {
    app.resetTestState();
    setLang("nn", { persist: false });
    app.setTestState({ routeChoice: "1135" });
    app.track("Route 1135");
    assert.deepEqual(calls.at(-1), calls[0], "vanilla sender det same");
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
    app.resetTestState();
  }
  assert.deepEqual(visitEvents(ui, "web", false), ["Visit nn"]);
  assert.deepEqual(visitEvents({ ...ui, lang: "de" }, "pwa", true), ["Visit de", "Visit pwa", "PWA first open"]);
  const storage = memoryStorage();
  assert.equal(core.markPwaFirstOpen(storage, "pwa"), true);
  assert.equal(core.markPwaFirstOpen(storage, "pwa"), false);
  assert.equal(core.markPwaFirstOpen(memoryStorage(), "web"), false);
});

test("data på /dev/: meldingar og signallogg frå produksjon, rutetabell frå dev", async () => {
  const dev = { origin: "https://teitrand.github.io", pathname: "/fergeruter/dev/", href: "https://teitrand.github.io/fergeruter/dev/" };
  const prod = { origin: "https://teitrand.github.io", pathname: "/fergeruter/", href: "https://teitrand.github.io/fergeruter/" };
  assert.equal(liveDataBase({}, dev), "https://teitrand.github.io/fergeruter/data/");
  assert.equal(liveDataBase({}, prod), "./data/");
  assert.equal(liveDataBase({}, null), "./data/");
  assert.equal(liveDataBase({ VITE_DATA_BASE: "/x/data" }, prod), "/x/data/");
  assert.equal(liveDataBase({ VITE_LIVE_DATA_BASE: "https://a.b/data" }, dev), "https://a.b/data/");
  // Same adresse som vanilla-appen les på /dev/.
  assert.equal(liveDataBase({}, dev) + "trafikkmeldinger.json", app.messagesUrl(dev));
  assert.equal(liveDataBase({}, dev) + "signalturar.json", app.signalLogUrl(dev));
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    return { ok: true, json: async () => (url.endsWith("ruter.json") ? ROUTES : null) };
  };
  await fetchAppData(fetchImpl, "./data/", "https://p/data/");
  assert.deepEqual(asked.sort(), [
    "./data/kombirute.json",
    "./data/korrespondanse.json",
    "./data/ruter.json",
    "https://p/data/signalturar.json",
    "https://p/data/trafikkmeldinger.json",
  ]);
});

test("fotnoten: posisjon, papirruteplan og NAIS som vanilla-appen", () => {
  setLang("nn", { persist: false });
  atOslo("2026-10-08", 12 * 60, () => {
    const base = { routes: ROUTES, kombirute: KOMBI, messages: null, signalLog: null };
    const ui = initialUi();
    const n1136 = footnoteModel(base, ui, routeChrome(base, ui));
    assert.equal(n1136.position, "position.planned");
    assert.equal(n1136.pdf.href, core.FJORD1_PDF);
    assert.equal(n1136.nais, "M/F Kvernes på NAIS");
    const ui1135 = initialUi({ routeChoice: "1135" });
    const n1135 = footnoteModel(base, ui1135, routeChrome(base, ui1135));
    assert.equal(n1135.pdf.href, core.FJORD1_PDF_1135);
    assert.match(n1135.nais, /Geiranger/);
    const kombi = initialUi({ override: "kombi" });
    const nk = footnoteModel(base, kombi, routeChrome(base, kombi));
    assert.equal(nk.pdf.href, KOMBI.source || core.KOMBI_PDF);
    assert.equal(nk.pdf.text, core.routeFootnotes("kombi").pdf.text);
    assert.equal(footnoteModel({ ...base, liveFailed: true }, ui, null).position, "position.offline");
    if (ROUTES.fetchedAt) assert.ok(n1136.updated);
    const empty = footnoteModel({ routes: null, kombirute: null }, ui, null);
    assert.deepEqual([empty.position, empty.pdf.href, empty.updated], ["position.planned", core.FJORD1_PDF, null]);
  });
  // Vanilla brukar same funksjon for fotnoten om posisjonen.
  app.resetTestState();
  app.setTestState({ routes: ROUTES, liveFailed: true });
  assert.equal(app.positionNoteKey(), "position.offline");
  app.resetTestState();
  assert.match(core.feedbackMailto("yes", "  hei "), /^mailto:teitrand@hotmail\.com\?subject=.+&body=.*hei/);
  assert.equal(app.feedbackMailto("no", ""), core.feedbackMailto("no", ""));
});

test("skalet lastar Plausible med same oppsett som vanilla (ingen hendingar frå localhost, /dev/ og førehandsvisinga)", () => {
  const snippet = (html) => {
    const start = html.indexOf("<!-- Privacy-friendly analytics by Plausible -->");
    const end = html.indexOf("</script>", html.indexOf("plausible.init", start));
    return start < 0 || end < 0 ? null : html.slice(start, end);
  };
  const vanilla = snippet(readFileSync(new URL("../index.html", import.meta.url), "utf8"));
  const shell = snippet(readFileSync(new URL("../web/index.html", import.meta.url), "utf8"));
  assert.ok(vanilla && vanilla.includes('path.indexOf("/dev/")'));
  // Førehandsvisinga på teitrand.github.io/ferjeruter-react/ skal ikkje telje i statistikken
  // til ruter.trandal.org. Elles same oppsett. I rota av eige domene blir hendingane sende.
  const guard = ' || path.indexOf("/ferjeruter-react/") !== -1';
  assert.ok(shell.includes(guard));
  assert.equal(shell.replace(guard, ""), vanilla);
});
