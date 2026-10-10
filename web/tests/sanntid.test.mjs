// AIS frå workeren i appen: parsing av /v1/latest, tilstand, feil og tidsavbrot, og at
// Entur og rutetabell tek over når workeren eller serveren er nede. Reine funksjonar, ingen React.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { earlyScript } from "../build/early-sanntid.js";
import { SANNTID_CACHE_KEY, readSanntidCache, writeSanntidCache } from "../src/model/sanntidCache.js";
import { takeEarlySanntid } from "../src/model/sanntidEarly.js";
import { bestFix, fixFreshness } from "../../packages/core/index.js";
import {
  SANNTID_IDLE_INTERVAL_MS,
  SANNTID_MIN_INTERVAL_MS,
  SANNTID_URL,
  emptySanntid,
  loadSanntid,
  mergeEntries,
  modeLines,
  parseSanntid,
  sanntidDue,
  sanntidReducer,
  sanntidUrl,
  withSanntid,
} from "../src/model/sanntid.js";

const T0 = Date.UTC(2026, 9, 8, 18, 30); // 20:30 Oslo
const ais = (over = {}) => ({
  source: "ais", mmsi: "257297400", name: "KVERNES", latitude: 62.2607, longitude: 6.5005, speedKn: 9.2, courseDeg: 44.4,
  heading: 22, navStatus: 0, msgtime: new Date(T0 - 5000).toISOString(), moored: false, state: "live", ...over,
});
const latest = (lines, over = {}) => ({ schema: 1, generatedAt: new Date(T0).toISOString(), collector: { lastHeartbeatAt: null, stale: false }, lines, today: { date: "2026-10-08", lines: {} }, ...over });

test("parseSanntid: AIS per linje blir PositionFix med AIS-tida (msgtime), ikkje når svaret kom", () => {
  const parsed = parseSanntid(latest({ 1136: { lastKnown: null, ais: ais() }, 1135: { lastKnown: null } }));
  assert.equal(parsed.entries.length, 1);
  const { line, fix } = parsed.entries[0];
  assert.equal(line, "1136");
  assert.deepEqual([fix.source, fix.vessel, fix.at, fix.speedKn, fix.course, fix.moored], ["ais", "257297400", T0 - 5000, 9.2, 44.4, false]);
  assert.equal(parseSanntid(latest({ 1136: { ais: ais({ navStatus: 5 }) } })).entries[0].fix.moored, true);
});

test("parseSanntid: manglande fart er ukjend (ikkje 0 kn), og ugyldig eller fremmed innhald blir hoppa over", () => {
  const { fix } = parseSanntid(latest({ 1136: { ais: ais({ speedKn: null, courseDeg: null, navStatus: null }) } })).entries[0];
  assert.deepEqual([fix.speedKn, fix.course], [null, null]);
  assert.equal(parseSanntid(latest({ 1136: { ais: ais({ latitude: 0, longitude: 0 }) } })).entries.length, 0);
  assert.equal(parseSanntid(latest({ 1136: { ais: ais({ msgtime: "i går" }) } })).entries.length, 0);
  assert.equal(parseSanntid(latest({ 1136: { ais: ais({ source: "entur" }) } })).entries.length, 0);
  for (const bad of [null, {}, { schema: 2, lines: {} }, { schema: 1 }, { schema: 1, lines: null }, "tekst"]) assert.equal(parseSanntid(bad), null);
  // Svar frå ein eldre worker utan ais: gyldig, utan posisjonar.
  assert.deepEqual(parseSanntid(latest({ 1136: { lastKnown: null, stale: true } })).entries, []);
});

test("loadSanntid: OK, HTTP-feil, ugyldig svar, nettfeil og 4 s tidsavbrot gjev { error } og kastar aldri", async () => {
  const ok = await loadSanntid(async () => new Response(JSON.stringify(latest({ 1136: { ais: ais() } }))), SANNTID_URL);
  assert.equal(ok.entries.length, 1);
  for (const impl of [
    async () => new Response("nei", { status: 503 }),
    async () => new Response("ikkje json"),
    async () => new Response(JSON.stringify({ schema: 9 })),
    async () => {
      throw new TypeError("Failed to fetch");
    },
  ]) {
    const result = await loadSanntid(impl, SANNTID_URL);
    assert.ok(result.error, JSON.stringify(result));
    assert.equal(result.entries, undefined);
  }
  const started = Date.now();
  const slow = await loadSanntid((url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("abort")))), SANNTID_URL, { timeoutMs: 30 });
  assert.match(slow.error, /abort/);
  assert.ok(Date.now() - started < 1000);
});

test("tilstand: nyaste posisjon per fartøy, eldre skriv ikkje over, tomt svar sletter ikkje", () => {
  const entry = (at, lat = 62.2) => ({ line: "1136", fix: { source: "ais", vessel: "257297400", at, latitude: lat, longitude: 6.5 } });
  let state = sanntidReducer(emptySanntid(), { type: "loaded", result: { entries: [entry(T0 - 5000, 62.3)] }, at: T0 });
  assert.equal(state.entries[0].fix.latitude, 62.3);
  const same = sanntidReducer(state, { type: "loaded", result: { entries: [entry(T0 - 5000, 62.3)] }, at: T0 + 15000 });
  assert.equal(same, state, "uendra svar gjev same tilstand (ingen ny teikning)");
  state = sanntidReducer(state, { type: "loaded", result: { entries: [entry(T0 - 90000, 62.1)] }, at: T0 + 15000 });
  assert.equal(state.entries[0].fix.latitude, 62.3, "eldre melding vinn ikkje");
  state = sanntidReducer(state, { type: "loaded", result: { entries: [] }, at: T0 + 30000 });
  assert.equal(state.entries.length, 1, "tomt svar sletter ikkje siste kjende");
  state = sanntidReducer(state, { type: "loaded", result: { entries: [entry(T0 + 20000, 62.4)] }, at: T0 + 40000 });
  assert.equal(state.entries[0].fix.latitude, 62.4);
  assert.deepEqual(mergeEntries([], []), []);
});

test("feil gjev backoff 1 → 2 → 4 min, held siste posisjon, og suksess nullstiller", () => {
  const entry = { line: "1136", fix: { source: "ais", vessel: "1", at: T0 - 1000 } };
  let state = sanntidReducer(emptySanntid(), { type: "loaded", result: { entries: [entry] }, at: T0 });
  state = sanntidReducer(state, { type: "loaded", result: { error: "503" }, at: T0 + 15000 });
  assert.equal(state.failed, true);
  assert.equal(state.entries.length, 1, "siste posisjon blir ståande");
  assert.equal(state.blockedUntil, T0 + 15000 + 60000);
  state = sanntidReducer(state, { type: "loaded", result: { error: "503" }, at: T0 + 90000 });
  assert.equal(state.blockedUntil, T0 + 90000 + 120000);
  state = sanntidReducer(state, { type: "loaded", result: { entries: [entry] }, at: T0 + 300000 });
  assert.deepEqual([state.failed, state.backoffMs, state.blockedUntil], [false, 0, 0]);
});

test("sanntidDue: ikkje gøymd fane, ikkje oftare enn 15 s, ikkje i backoff, berre i driftsvindauget", () => {
  const data = { routes: JSON.parse(readTimetable()), kombirute: null, messages: null };
  const ui = { routeChoice: "1136", date: null, lang: "nn", showPast: false, override: null };
  assert.equal(sanntidDue({ fetchedAt: 0 }, data, ui, T0, false), true);
  assert.equal(sanntidDue({ fetchedAt: 0 }, data, ui, T0, true), false, "gøymd fane");
  assert.equal(sanntidDue({ fetchedAt: T0 - SANNTID_MIN_INTERVAL_MS + 1000 }, data, ui, T0), false);
  assert.equal(sanntidDue({ fetchedAt: T0 - SANNTID_MIN_INTERVAL_MS }, data, ui, T0), true);
  assert.equal(sanntidDue({ fetchedAt: 0, blockedUntil: T0 + 1 }, data, ui, T0), false, "backoff");
  // Natt (utanfor driftsvindauget): AIS sender heile døgnet, så vi spør, men berre kvart minutt, og framleis ikkje i gøymd fane eller backoff.
  // 03:10 Oslo: utanfor driftsvindauget uansett vekedag (rutetabellen er den for den verkelege dagen i dag, og laurdag/søndag køyrer lenger enn kl. 21:10).
  const night = Date.UTC(2026, 9, 8, 1, 10);
  assert.equal(sanntidDue({ fetchedAt: 0 }, data, ui, night), true, "natt: fyrste kall med ein gong");
  assert.equal(sanntidDue({ fetchedAt: night - SANNTID_IDLE_INTERVAL_MS + 1000 }, data, ui, night), false, "natt: ikkje oftare enn kvart minutt");
  assert.equal(sanntidDue({ fetchedAt: night - SANNTID_IDLE_INTERVAL_MS }, data, ui, night), true);
  assert.equal(sanntidDue({ fetchedAt: 0 }, data, ui, night, true), false, "natt: ikkje i gøymd fane");
  assert.equal(sanntidDue({ fetchedAt: 0, blockedUntil: night + 1 }, data, ui, night), false, "natt: ikkje i backoff");
  assert.equal(sanntidDue({ fetchedAt: night - 20000 }, data, ui, Date.UTC(2026, 9, 8, 1, 0)), false, "midt på natta: ikkje oftare enn kvart minutt");
  assert.equal(SANNTID_IDLE_INTERVAL_MS, 60000);
  // Utan rutetabell (ikkje komen enno): berre det fyrste kallet, med ein gong; ikkje i gøymd fane og ikkje i backoff.
  assert.equal(sanntidDue({ fetchedAt: 0 }, { routes: null, kombirute: null }, ui, T0), true, "fyrste kall før rutetabellen");
  assert.equal(sanntidDue({ fetchedAt: T0 - 60000 }, { routes: null, kombirute: null }, ui, T0), false, "berre det fyrste");
  assert.equal(sanntidDue({ fetchedAt: 0 }, { routes: null, kombirute: null }, ui, T0, true), false);
  assert.equal(sanntidDue({ fetchedAt: 0, blockedUntil: T0 + 1 }, { routes: null, kombirute: null }, ui, T0), false);
});

function readTimetable() {
  return readFileSync(new URL("../../tests/fixtures/ruter.json", import.meta.url), "utf8");
}

test("sanntidUrl: standard er workeren; VITE_SANNTID_URL overstyrer; off og tom slår av", () => {
  assert.equal(sanntidUrl({}), SANNTID_URL);
  assert.equal(sanntidUrl({ VITE_SANNTID_URL: "https://x.example/v1/latest" }), "https://x.example/v1/latest");
  assert.equal(sanntidUrl({ VITE_SANNTID_URL: "off" }), null);
  assert.equal(sanntidUrl({ VITE_SANNTID_URL: "" }), null);
});

test("withSanntid: berre linjene i sambandet (kombi gjev begge), og av gjev data uendra", () => {
  const e = (line, vessel) => ({ line, fix: { source: "ais", vessel, at: T0 } });
  const state = { ...emptySanntid(), entries: [e("1136", "a"), e("1135", "b")] };
  const base = { routes: null };
  assert.deepEqual(withSanntid(base, state, "1136").positions.map((f) => f.vessel), ["a"]);
  assert.deepEqual(withSanntid(base, state, "1135").positions.map((f) => f.vessel), ["b"]);
  assert.deepEqual(withSanntid(base, state, "kombi").positions.map((f) => f.vessel), ["a", "b"]);
  assert.deepEqual(withSanntid(base, state, null).positions, []);
  assert.equal(withSanntid(base, state, "1136", { on: false }), base);
  assert.equal(withSanntid(base, state, "1136").sanntidOn, true);
  assert.deepEqual(modeLines("kombi"), ["1136", "1135"]);
});

test("fallback-kjeda: AIS eldast av seg sjølv (live → siste kjende → ukjend), så tek Entur over, så rutetabellen", () => {
  const aisFix = parseSanntid(latest({ 1136: { ais: ais({ msgtime: new Date(T0).toISOString() }) } })).entries[0].fix;
  const entur = { ...aisFix, source: "entur", at: T0 + 100000, speedKn: null, course: null };
  const at = (s) => T0 + s * 1000;
  assert.deepEqual([30, 90, 400].map((s) => fixFreshness(aisFix, at(s))), ["live", "stale", "unknown"]);
  assert.equal(bestFix([aisFix], at(30)).source, "ais");
  assert.equal(bestFix([aisFix, entur], at(105)).source, "entur", "AIS er siste kjende (105 s), Entur er live");
  assert.equal(fixFreshness(bestFix([aisFix], at(400)), at(400)), "unknown", "ingen live posisjon att: appen viser Ukjent og rutetabellen");
});

test("tidleg henting: svaret frå index.html blir brukt ein gong, for same adresse; feil gjev vanleg feil", async () => {
  const scope = { __sanntidEarly: { url: SANNTID_URL, promise: Promise.resolve(latest({ 1136: { ais: ais() } })) } };
  assert.equal(takeEarlySanntid("https://anna.example/v1/latest", scope), null, "anna adresse");
  const early = takeEarlySanntid(SANNTID_URL, scope);
  assert.ok(early);
  assert.equal(takeEarlySanntid(SANNTID_URL, scope), null, "berre ein gong");
  assert.equal(takeEarlySanntid(SANNTID_URL, {}), null, "ingen tidleg henting");
  let called = 0;
  const ok = await loadSanntid(async () => { called++; }, SANNTID_URL, { early });
  assert.equal(called, 0, "ingen nytt kall");
  assert.equal(ok.entries.length, 1);
  assert.equal(ok.entries[0].line, "1136");
  assert.ok((await loadSanntid(async () => {}, SANNTID_URL, { early: Promise.reject(new Error("503")) })).error);
  assert.ok((await loadSanntid(async () => {}, SANNTID_URL, { early: Promise.resolve({ schema: 2 }) })).error, "ugyldig svar");
});

test("tidleg henting: skriptet i <head> er gyldig JS med adressa, med avbrot og utan å kaste", () => {
  const code = earlyScript(SANNTID_URL);
  new Function(code); // syntaksen held
  assert.ok(code.includes(JSON.stringify(SANNTID_URL)));
  assert.match(code, /credentials:"omit"/);
  assert.match(code, /c\.abort\(\)/);
  const win = {};
  new Function("window", "fetch", "AbortController", "setTimeout", code)(win, () => Promise.reject(new Error("nett")), AbortController, () => 0);
  assert.equal(win.__sanntidEarly.url, SANNTID_URL);
  return win.__sanntidEarly.promise.then(() => assert.fail("skulle feile"), () => {});
});

test("sist kjende posisjon i lagring: alderen er msgtime, ikkje lagringstida; søppel og gamalt blir kasta", () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.deepEqual(readSanntidCache(storage, T0), []);
  const parsed = parseSanntid(latest({ 1136: { ais: ais() } })).entries;
  writeSanntidCache(parsed, storage);
  const back = readSanntidCache(storage, T0);
  assert.equal(back.length, 1);
  assert.equal(back[0].fix.at, parsed[0].fix.at, "same tid som AIS-meldinga");
  // Tre timar seinare er posisjonen framleis med, men han er ikkje lenger «live»: alderen følgjer msgtime.
  const later = readSanntidCache(storage, T0 + 3 * 3600000);
  assert.equal(later.length, 1);
  assert.equal(fixFreshness(later[0].fix, T0 + 3 * 3600000), "unknown");
  assert.equal(fixFreshness(back[0].fix, T0), "live");
  assert.equal(readSanntidCache(storage, T0 + 25 * 3600000).length, 0, "over eit døgn");
  mem.set(SANNTID_CACHE_KEY, "{ikkje json");
  assert.deepEqual(readSanntidCache(storage, T0), []);
  mem.set(SANNTID_CACHE_KEY, JSON.stringify({ v: 1, entries: [{ line: "1136", fix: { source: "ais", latitude: "x", longitude: 6, at: T0 } }, { line: "1136", fix: { ...parsed[0].fix, at: T0 + 3600000 } }, null] }));
  assert.deepEqual(readSanntidCache(storage, T0), [], "ugyldig og frå framtida");
  mem.set(SANNTID_CACHE_KEY, JSON.stringify({ v: 2, entries: parsed }));
  assert.deepEqual(readSanntidCache(storage, T0), [], "ukjend versjon");
  assert.doesNotThrow(() => writeSanntidCache(parsed, { setItem() { throw new Error("full"); } }));
  assert.deepEqual(readSanntidCache(null, T0), []);
});

test("tilstand: loaded etter fyrste svar eller feil, og sanntidPending til då", () => {
  let state = emptySanntid();
  assert.equal(state.loaded, false);
  assert.equal(withSanntid({ routes: {} }, state, "1136").sanntidPending, true);
  const failed = sanntidReducer(state, { type: "loaded", result: { error: "nett" }, at: T0 });
  assert.equal(failed.loaded, true);
  assert.equal(withSanntid({ routes: {} }, failed, "1136").sanntidPending, false);
  const none = sanntidReducer(state, { type: "loaded", result: { entries: [] }, at: T0 });
  assert.equal(none.loaded, true, "tomt svar er òg eit svar");
  assert.equal(sanntidReducer(none, { type: "loaded", result: { entries: [] }, at: T0 }), none, "same tilstand ut");
  // Posisjonar frå lagringa blir ståande til det ferske svaret tek over.
  state = { ...emptySanntid(), entries: parseSanntid(latest({ 1136: { ais: ais() } })).entries };
  const fresh = sanntidReducer(state, { type: "loaded", result: { entries: parseSanntid(latest({ 1136: { ais: ais({ msgtime: new Date(T0).toISOString() }) } })).entries }, at: T0 });
  assert.equal(fresh.entries[0].fix.at, T0);
  assert.equal(fresh.loaded, true);
});
