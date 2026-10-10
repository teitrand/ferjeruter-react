// Teiknetestar for sanntidsdelane: «No»-kortet (Designer V2: hovudlinje, støttelinje, ferja på linja, kjeldemerke), nedteljinga og
// live-regionen. Tenarsideteikning gjennom Vite, same oppsett som render.test.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const repo = new URL("../../", import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, repo), "utf8"));
const ROUTES = json("tests/fixtures/ruter.json");
const LOG = json("tests/fixtures/signalturar_2026-10-02_08.json");
const VM = json("tests/fixtures/vm_2026-10-08_2030.json");

const oslo = (h, m, s = 0) => Date.UTC(2026, 9, 8, h - 2, m, s);
// 8. oktober 2026 kl. 20:30 i Oslo: 20:20-turen Trandal → Standal er i gang etter rutetabellen.
const FIXED = oslo(20, 30);
let current = FIXED;
const RealDate = Date;

let server;
let App;
let Countdown;
let AnnouncerProvider;
let memoryOnly;
let core;
let nowcard;

before(async () => {
  server = await createServer({
    root,
    configFile: fileURLToPath(new URL("../vite.config.js", import.meta.url)),
    logLevel: "error",
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  ({ App } = await server.ssrLoadModule("/src/App.jsx"));
  ({ Countdown } = await server.ssrLoadModule("/src/components/Countdown.jsx"));
  ({ AnnouncerProvider } = await server.ssrLoadModule("/src/components/Announcer.jsx"));
  ({ memoryOnly } = await server.ssrLoadModule("/src/model/context.js"));
  core = await server.ssrLoadModule("/../packages/core/index.js");
  nowcard = await server.ssrLoadModule("/src/model/nowcard.js");
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [current]));
    }
    static now() {
      return current;
    }
  };
});

after(async () => {
  globalThis.Date = RealDate;
  await server?.close();
});

const clean = (html) => html.replace(/<!-- -->/g, "");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const strip = (html) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

test("nedteljing: synleg tekst aria-hidden, skjermlesartekst per minutt utan live-region", async () => {
  const { setLang } = await server.ssrLoadModule("/src/components/i18n.js");
  setLang("nn");
  const html = clean(renderToString(createElement(Countdown, { time: "20:34:05", nowMs: FIXED })));
  assert.match(html, /<span class="countdown-text is-tabular" aria-hidden="true">om 4:05<\/span>/);
  assert.match(html, /<span class="visually-hidden">om 5 min<\/span>/);
  assert.doesNotMatch(html, /aria-live/);
});

test("live-regionen: éin, polite og atomic", () => {
  const html = clean(renderToString(createElement(AnnouncerProvider, null, "x")));
  assert.match(html, /<div class="visually-hidden" aria-live="polite" aria-atomic="true" data-announcer="">/);
});

function renderApp({ initialEntur = null, initialSanntid = null, lang = "nn" } = {}) {
  const signalLog = { days: { "2026-10-08": LOG.days["2026-10-08"] } };
  const initialData = { routes: ROUTES, kombirute: null, messages: null, signalLog, connections: null };
  const initialState = { routeChoice: "1136", lang, override: null, date: null, showPast: true };
  const app = createElement(App, { initialData, initialEntur, initialSanntid, initialState, memory: memoryOnly() });
  return clean(renderToString(createElement(AnnouncerProvider, null, app)));
}

/** Statusområdet øvst: berre statuslinja. */
const statusArea = (html) => html.match(/<div class="status-area">.*?<\/header>/s)?.[0] || "";
/** «No»-kortet over tidslinja. */
function nowArea(html) {
  return html.match(/<section class="na [^>]*>.*?<\/section>/s)?.[0] || "";
}
const mainLine = (html) => strip(nowArea(html).match(/<p class="na-main">(.*?)<\/p>/s)?.[1] || "");
const supportLines = (html) => [...nowArea(html).matchAll(/<p class="na-support na-support-(\w+)">(.*?)<\/p>/gs)].map((m) => `${m[1]}: ${strip(m[2])}`);
const badgeText = (html) => strip(nowArea(html).match(/<span class="na-badge-text">(.*?)<\/span>/s)?.[1] || "");
const sentenceOf = (html) => strip(nowArea(html).match(/<p class="visually-hidden">(.*?)<\/p>/s)?.[1] || "");
const sceneOf = (html) => nowArea(html).match(/<div class="na-scene[^>]*>/)?.[0] || "";


// --- «No»-kortet: modellen (composeNowCard) per tilstand ---

const BASE = { mode: "underway", quay: null, place: "Ferja er på veg mot Standal", leg: { from: "Trandal", to: "Standal", departure: "20:20", arrival: "20:35" }, legKind: "crossing", legAhead: 0, legDay: null, scheduled: null, cancelled: null, lastQuay: null, pending: false };
const VIEW = { state: "live", source: "ais", ageMs: 12000, fixAt: FIXED - 12000, progress: 0.62, arrival: "20:35", speedKn: 9 };

test("modellen: på veg med live AIS – hovudlinje, fart og framkomst, ferje med kjølvatn og fylt linje", async () => {
  const { setLang } = await server.ssrLoadModule("/src/components/i18n.js");
  setLang("nn");
  const card = nowcard.composeNowCard(BASE, VIEW);
  assert.equal(card.main, "På veg mot Standal");
  assert.deepEqual(card.support, [{ kind: "move", text: "9 knop · framme ca. 20:35" }]);
  assert.deepEqual(card.badge, { icon: "live", text: "Live frå AIS · 12 s" });
  assert.deepEqual(card.scene, { kind: "line", from: "Trandal", to: "Standal", x: 0.62, fill: "solid", dashed: false, moving: true, marker: null, faded: false });
  assert.equal(card.sentence, "Ferja er på veg mot Standal. 9 knop · framme ca. 20:35. Målt med AIS.");
  assert.doesNotMatch(card.sentence, /sekund|\d+ s\b/, "ingen sekundteljing i setninga til skjermlesar");
  // Ingen fart: ingen kjølvatn, ingen «0 knop».
  const still = nowcard.composeNowCard(BASE, { ...VIEW, speedKn: null });
  assert.equal(still.scene.moving, false);
  assert.deepEqual(still.support, [{ kind: "move", text: "framme ca. 20:35" }]);
});

test("modellen: siste kjende, ukjend, berekna og laster – stipla, ≈ og ? berre éin stad, ærlege merke", async () => {
  const { setLang } = await server.ssrLoadModule("/src/components/i18n.js");
  setLang("nn");
  const stale = nowcard.composeNowCard(BASE, { ...VIEW, state: "stale", ageMs: 3 * 60000, fixAt: FIXED - 3 * 60000 });
  assert.equal(stale.badge.text, "Siste kjende frå AIS · 3 min sidan");
  assert.equal(stale.badge.icon, "clock");
  assert.equal(stale.scene.dashed, true);
  assert.equal(stale.scene.fill, "soft");
  assert.equal(stale.scene.moving, false, "ingen kjølvatn på ein gammal posisjon");
  assert.match(stale.sentence, /Siste kjende AIS-posisjon kl\. 20:27\.$/);

  const unknown = nowcard.composeNowCard({ ...BASE, lastQuay: "Trandal" }, { state: "unknown", source: "computed", ageMs: 48 * 60000, fixAt: FIXED - 48 * 60000, progress: 0.65, arrival: "20:35" });
  assert.equal(unknown.main, "Ukjent · ingen sanntid sidan 19:42");
  assert.deepEqual(unknown.support.map((line) => line.text), ["Sist sett ved kai på Trandal.", "Kvar ferja er no, veit vi ikkje."]);
  assert.equal(unknown.badge.text, "Siste kjende · 48 min sidan");
  assert.deepEqual([unknown.scene.marker, unknown.scene.faded, unknown.scene.fill, unknown.scene.x], ["?", true, "none", 0], "ferja står der vi sist såg ho, ikkje der tabellen seier");
  assert.doesNotMatch(unknown.sentence, /knop|framme/, "ingen fart og ingen ankomst når posisjonen er ukjend");

  const calc = nowcard.composeNowCard(BASE, { state: "calc", source: "computed", ageMs: null, fixAt: null, progress: 0.65, arrival: "20:35" });
  assert.equal(calc.main, "Truleg på veg mot Standal");
  assert.equal(calc.support[0].text, "Fart ukjend · berekna framme ca. 20:35 · ikkje målt");
  assert.equal(calc.badge.text, "Berekna frå rutetabellen");
  assert.doesNotMatch(calc.badge.text, /≈/, "ikonet er teikna, teksten har ikkje teiknet: ingen dobbel ≈");
  assert.doesNotMatch(calc.main, /≈/);
  assert.deepEqual([calc.scene.marker, calc.scene.fill, calc.scene.dashed], ["≈", "striped", true]);

  const loading = nowcard.composeNowCard({ ...BASE, pending: true }, { state: "calc", source: "computed", progress: 0.65, arrival: "20:35" });
  assert.equal(loading.badge.text, "Hentar posisjon …");
  assert.equal(loading.state, "loading");
  assert.match(loading.sentence, /Hentar posisjon\.$/);
});

test("modellen: utanfor ruta – blå tagg, ingen line mellom kaiane, ingen fart, ingen ankomst", async () => {
  const { setLang } = await server.ssrLoadModule("/src/components/i18n.js");
  setLang("nn");
  const card = nowcard.composeNowCard({ ...BASE, mode: "outside" }, { state: "outside", source: "ais", ageMs: 15000, fixAt: FIXED - 15000 });
  assert.equal(card.tag, "Utanfor ruta");
  assert.equal(card.main, "Ferja er utanfor ruta");
  assert.deepEqual(card.scene, { kind: "outside" });
  assert.equal(card.badge.text, "Live frå AIS · 15 s");
  assert.doesNotMatch(card.sentence, /framme|knop|Planlagd/);
});

test("modellen: ved kai – planlagd avgang og overfart frå ekte tider; ferja står på kaia ho ligg ved", async () => {
  const { setLang } = await server.ssrLoadModule("/src/components/i18n.js");
  setLang("nn");
  const moored = { mode: "moored", quay: "Standal", place: "Ferja ligg til kai på Standal", leg: { from: "Standal", to: "Trandal", departure: "20:50", arrival: "21:05" }, legKind: "upcoming", legAhead: 0, legDay: null, scheduled: null, cancelled: null, lastQuay: "Standal", pending: false };
  const live = { state: "live", source: "ais", ageMs: 12000, fixAt: FIXED - 12000 };
  const card = nowcard.composeNowCard(moored, live);
  assert.equal(card.main, "Ligg til kai på Standal");
  assert.deepEqual(card.support.map((line) => line.text), ["Planlagd avgang 20:50 til Trandal", "Overfart ca. 15 min · framme 21:05"]);
  assert.deepEqual([card.scene.from, card.scene.to, card.scene.x, card.scene.fill, card.scene.dashed], ["Standal", "Trandal", 0, "none", false]);
  assert.equal(card.sentence, "Ferja ligg til kai på Standal. Planlagd avgang 20:50 til Trandal. Overfart ca. 15 min · framme 21:05. Målt med AIS.");
  // Natt ved Trandal, første tur i morgon frå Standal: ferja står på Trandal-enden, ikkje på startkaia til turen.
  const night = nowcard.composeNowCard({ ...moored, quay: "Trandal", place: "Ferja ligg til kai på Trandal", legKind: "first", legAhead: 1, legDay: "2026-10-09", leg: { from: "Standal", to: "Trandal", departure: "06:45", arrival: "07:00" } }, live);
  assert.equal(night.main, "Ligg til kai på Trandal");
  assert.equal(night.support[0].text, "Første tur i morgon 06:45 frå Standal");
  assert.deepEqual([night.scene.from, night.scene.to, night.scene.x], ["Standal", "Trandal", 1]);
  // Ligg ved ei anna kai enn turen startar frå: ingen «Planlagd avgang» herifrå, og berre éi kai teikna.
  const other = nowcard.composeNowCard({ ...moored, quay: "Sæbø", leg: { from: "Valderøya", to: "Store Kalvøy", departure: "21:15", arrival: "21:35" } }, live);
  assert.equal(other.support[0].text, "Neste avgang 21:15 frå Valderøya");
  assert.equal(other.support.length, 1, "ingen overfartstid for ein tur ferja ikkje startar frå her");
  assert.deepEqual([other.scene.from, other.scene.to], ["Sæbø", null]);
  // Forseinka: tabellen seier overfart, ferja ligg ved kai. Oransje er berre for slike åtvaringar.
  const late = nowcard.composeNowCard({ ...moored, legKind: "scheduled", scheduled: "Planlagd avgang 20:50 frå Standal" }, live);
  assert.deepEqual(late.support[0], { kind: "delay", text: "Planlagd avgang 20:50 frå Standal" });
  const cancelled = nowcard.composeNowCard({ ...moored, cancelled: "Avgangen 21:30 frå Standal er avlyst" }, live);
  assert.deepEqual(cancelled.support.at(-1), { kind: "cancelled", text: "Avgangen 21:30 frå Standal er avlyst" });
});

test("modellen: Entur som kjelde seier Entur, ikkje AIS", async () => {
  const { setLang } = await server.ssrLoadModule("/src/components/i18n.js");
  setLang("nn");
  const card = nowcard.composeNowCard(BASE, { ...VIEW, source: "entur", speedKn: null });
  assert.equal(card.badge.text, "Live frå Entur · 12 s");
  assert.match(card.sentence, /frå sanntid hos Entur\.$/);
  assert.doesNotMatch(card.sentence, /AIS/);
});

test("modellen: nn, en og de", async () => {
  const { setLang } = await server.ssrLoadModule("/src/components/i18n.js");
  setLang("en");
  assert.equal(nowcard.composeNowCard(BASE, VIEW).sentence, "The ferry is heading to Standal. 9 knots · arriving approx. 20:35. Measured with AIS.");
  assert.equal(nowcard.composeNowCard(BASE, VIEW).label, "The ferry now");
  setLang("de");
  const de = nowcard.composeNowCard(BASE, VIEW);
  assert.equal(de.main, "Unterwegs nach Standal");
  assert.equal(de.sentence, "Die Fähre ist unterwegs nach Standal. 9 Knoten · Ankunft ca. 20:35. Mit AIS gemessen.");
  assert.equal(de.label, "Die Fähre jetzt");
  setLang("nn");
});

// --- «No»-kortet i appen ---

test("appen: kortet står over lista med «Turar», ikkje som rad i tidslinja; role=status utan eigen live-region", () => {
  const html = renderApp();
  const card = nowArea(html);
  assert.ok(html.indexOf('class="na ') > 0 && html.indexOf('class="na ') < html.indexOf('class="trips-heading"') && html.indexOf('class="trips-heading"') < html.indexOf('class="timeline"'));
  assert.doesNotMatch(html, /class="now[ "]/, "ingen «No»-rad i tidslinja");
  assert.match(card, /^<section class="na na-underway na-state-calc" id="na-card" role="status" aria-live="off" aria-label="Ferja no" data-state="calc" data-mode="underway">/);
  assert.equal((html.match(/data-announcer=""/g) || []).length, 1, "éin felles live-region for sanntid");
  // Synleg innhald er aria-hidden; skjermlesar får éi setning.
  assert.match(card, /<div class="na-body" aria-hidden="true">/);
  assert.equal(sentenceOf(html), "Truleg på veg mot Standal. Fart ukjend · berekna framme ca. 20:35 · ikkje målt. Berekna frå rutetabellen, ikkje målt.");
  assert.doesNotMatch(card, /role="progressbar"|aria-valuetext/, "ferja og linja er pynt (aria-hidden), ikkje ein progressbar");
  assert.match(sceneOf(html), /aria-hidden="true"/);
  assert.match(sceneOf(html), /class="na-scene na-fill-striped is-dashed/);
  assert.match(card, /<svg class="na-ferry-svg" viewBox="0 0 96 32"/);
  const head = statusArea(html);
  assert.match(head, /<p class="lede" id="lede-status">Ferja er på veg mot Standal\. /, "teksten i toppen kjem frå currentStatus, som før");
  assert.doesNotMatch(head, /class="na|class="live"|role="progressbar"/, "ingen sanntidsboks øvst");
  assert.equal(mainLine(html), "Truleg på veg mot Standal");
  assert.equal(badgeText(html), "Berekna frå rutetabellen");
});

test("appen: Entur-posisjon midt på fjorden gjev målt framdrift; ekte VM ved kai gjev ingen overfart", () => {
  // Den ekte meldinga: ferja kom til Standal 20:30:45, før rutetida. Då er overfarten over.
  const arrived = renderApp({ initialEntur: { live: { ...core.parseVehicleMonitoring(VM), validUntil: "2099-01-01T00:00:00Z" } } });
  assert.doesNotMatch(mainLine(arrived), /på veg/);
  // Same melding, flytta ut på fjorden 10 s før «no» (syntetisk).
  const html = renderApp({ initialEntur: { live: enturLive(0.7, 10000) } });
  assert.match(nowArea(html), /data-state="live"/);
  assert.equal(badgeText(html), "Live frå Entur · 10 s");
  assert.equal(mainLine(html), "På veg mot Standal");
  assert.match(sentenceOf(html), /Målt, frå sanntid hos Entur\.$/);
  assert.match(sceneOf(html), /na-fill-solid is-solid/);
});

test("appen: ved kai (rutetabell): statuslinja har tikkande nedteljing, kortet seier berekna og viser avgangen", () => {
  current = oslo(20, 16);
  try {
    const html = renderApp();
    assert.match(
      statusArea(html),
      /<p class="lede" id="lede-status">Ferja ligg til kai på Trandal\. Neste avgang 20:20 frå Trandal, <span class="countdown"><span class="countdown-text is-tabular" aria-hidden="true">om 4:00<\/span><span class="visually-hidden">om 4 min<\/span><\/span> · på signal, fristen er ute\./
    );
    assert.equal(mainLine(html), "Ferja ligg til kai på Trandal");
    assert.deepEqual(supportLines(html), ["plan: Planlagd avgang 20:20 til Standal", "trip: Overfart ca. 15 min · framme 20:35"]);
    assert.equal(badgeText(html), "Berekna frå rutetabellen");
    assert.match(sceneOf(html), /is-dashed/);
  } finally {
    current = FIXED;
  }
});


// --- AIS > Entur > rutetabell i appen (initialSanntid er det workeren ga) ---

const T = () => core.QUAY_COORDS.Trandal;
const S = () => core.QUAY_COORDS.Standal;
/** AIS-fix `f` (0..1) frå Trandal mot Standal, `ageMs` gammal ved FIXED. */
function aisEntry(f, ageMs, { line = "1136", mmsi = 257297400, sog = 10 } = {}) {
  const a = T();
  const b = S();
  const fix = core.fixFromAis({
    mmsi, latitude: a.latitude + (b.latitude - a.latitude) * f, longitude: a.longitude + (b.longitude - a.longitude) * f,
    sog, cog: 90, navStatus: 0, timestamp: FIXED - ageMs,
  });
  return { line, fix };
}
/** Entur-VM midt på fjorden, `ageMs` gammal ved FIXED. */
function enturLive(f, ageMs) {
  const message = structuredClone(VM);
  const activity = message.Siri.ServiceDelivery.VehicleMonitoringDelivery[0].VehicleActivity[0];
  activity.RecordedAtTime = new RealDate(FIXED - ageMs).toISOString();
  activity.ValidUntilTime = new RealDate(FIXED + 110000).toISOString();
  const call = activity.MonitoredVehicleJourney.MonitoredCall;
  call.VehicleAtStop = false;
  delete call.ActualArrivalTime;
  const a = T();
  const b = S();
  activity.MonitoredVehicleJourney.VehicleLocation = {
    Latitude: a.latitude + (b.latitude - a.latitude) * f,
    Longitude: a.longitude + (b.longitude - a.longitude) * f,
  };
  return core.parseVehicleMonitoring(message);
}
const footnote = (html) => text(html).match(/Posisjonen kjem frå [A-Za-z]+ i sanntid no\.|Ingen sanntidsposisjon frå AIS eller Entur no\.|Entur har ingen posisjon[^.]*\.|Fekk ikkje kontakt med Entur[^.]*\./)?.[0] || "";


// --- AIS > Entur > rutetabell i appen (initialSanntid er det workeren ga) ---

test("appen: AIS er sanninga – live frå AIS vinn over ein Entur-posisjon, og ingenting i kortet eller toppen seier Entur", () => {
  const html = renderApp({ initialEntur: { live: enturLive(0.7, 10000) }, initialSanntid: { entries: [aisEntry(0.5, 8000)] } });
  const area = nowArea(html);
  assert.equal(badgeText(html), "Live frå AIS · 8 s");
  assert.equal(mainLine(html), "På veg mot Standal");
  assert.deepEqual(supportLines(html), ["move: 10 knop · framme ca. 20:35"]);
  assert.match(sceneOf(html), /na-fill-solid is-solid is-moving/);
  assert.match(area, /<span class="na-wake">/, "kjølvatn berre i fart");
  assert.equal(sentenceOf(html), "Ferja er på veg mot Standal. 10 knop · framme ca. 20:35. Målt med AIS.");
  assert.doesNotMatch(strip(area), /Entur/);
  assert.doesNotMatch(area, /aria-[a-z]+="[^"]*Entur/);
  assert.equal(footnote(html), "Posisjonen kjem frå AIS i sanntid no.");
});

test("appen: berre AIS (Entur utan posisjon) gjev heil linje og live frå AIS", () => {
  const html = renderApp({ initialSanntid: { entries: [aisEntry(0.4, 20000)] } });
  assert.match(nowArea(html), /data-state="live"/);
  assert.equal(badgeText(html), "Live frå AIS · 20 s");
  assert.doesNotMatch(strip(nowArea(html)), /Entur/);
  assert.equal(footnote(html), "Posisjonen kjem frå AIS i sanntid no.");
});

test("appen: AIS er gammal og Entur live – då er Entur kjelda, og det står Entur, ikkje AIS", () => {
  const html = renderApp({ initialEntur: { live: enturLive(0.7, 10000) }, initialSanntid: { entries: [aisEntry(0.3, 2 * 60000)] } });
  assert.equal(badgeText(html), "Live frå Entur · 10 s");
  assert.match(sentenceOf(html), /frå sanntid hos Entur\.$/);
  assert.doesNotMatch(strip(nowArea(html)), /AIS/);
  assert.equal(footnote(html), "Posisjonen kjem frå Entur i sanntid no.");
});

test("appen: siste kjende AIS er stipla og seier AIS; for gammal er ukjend, utan fart og ankomst; verken Entur eller AIS", () => {
  const stale = renderApp({ initialSanntid: { entries: [aisEntry(0.4, 3 * 60000)] } });
  assert.match(nowArea(stale), /data-state="stale"/);
  assert.equal(badgeText(stale), "Siste kjende frå AIS · 3 min sidan");
  assert.match(sceneOf(stale), /na-fill-soft is-dashed/);
  assert.match(sentenceOf(stale), /Siste kjende AIS-posisjon kl\. 20:27\.$/);
  assert.doesNotMatch(strip(nowArea(stale)), /Entur/);
  const unknown = renderApp({ initialSanntid: { entries: [aisEntry(0.4, 8 * 60000)] } });
  assert.match(nowArea(unknown), /data-state="unknown"/);
  assert.equal(mainLine(unknown), "Ukjent · ingen sanntid sidan 20:22");
  assert.deepEqual(supportLines(unknown), ["note: Kvar ferja er no, veit vi ikkje."]);
  assert.equal(badgeText(unknown), "Siste kjende · 8 min sidan");
  assert.match(sceneOf(unknown), /is-dashed is-faded/);
  assert.match(nowArea(unknown), /<span class="na-marker">\?<\/span>/);
  assert.doesNotMatch(strip(nowArea(unknown)), /AIS|Entur|knop|framme/);
});

test("appen: workeren nede og ingen Entur – rutetabellen, stipla, ærleg merka (ingen feilmelding)", () => {
  const html = renderApp({ initialSanntid: { entries: [], failed: true } });
  assert.match(nowArea(html), /data-state="calc"/);
  assert.equal(badgeText(html), "Berekna frå rutetabellen");
  assert.match(nowArea(html), /<span class="na-marker">≈<\/span>/);
  assert.doesNotMatch(strip(nowArea(html)).replace(/Berekna frå rutetabellen/, ""), /AIS|Entur/);
  assert.equal(footnote(html), "Ingen sanntidsposisjon frå AIS eller Entur no.");
  const withEntur = renderApp({ initialEntur: { live: enturLive(0.7, 10000) }, initialSanntid: { entries: [], failed: true } });
  assert.equal(badgeText(withEntur), "Live frå Entur · 10 s");
});

test("appen: AIS frå ei anna linje (1135) blir ikkje brukt for 1136", () => {
  const html = renderApp({ initialSanntid: { entries: [aisEntry(0.5, 5000, { line: "1135", mmsi: 257262400 })] } });
  assert.match(nowArea(html), /data-state="calc"/);
  assert.doesNotMatch(strip(nowArea(html)), /AIS/);
});

test("appen: utan AIS-kjelda (sanntid av) er teksten som før og Entur-notat uendra", () => {
  const html = renderApp({ initialEntur: { live: enturLive(0.7, 10000) } });
  assert.equal(badgeText(html), "Live frå Entur · 10 s");
  assert.equal(footnote(html), "Posisjonen kjem frå Entur i sanntid no.");
});

test("appen: AIS ved kai mot rutetabellen sin «på veg» – statuslinja og kortet er samde, ferja står ved kaia", () => {
  const html = renderApp({ initialSanntid: { entries: [aisEntry(1, 20000, { sog: 0 })] } });
  assert.match(statusArea(html), /<p class="lede" id="lede-status">Ferja ligg til kai på Standal\./);
  assert.doesNotMatch(statusArea(html), /på veg/);
  assert.equal(mainLine(html), "Ligg til kai på Standal");
  assert.equal(badgeText(html), "Live frå AIS · 20 s");
  assert.match(nowArea(html), /class="na na-moored na-state-live"/);
  // Same ferje i fart midt på fjorden: statuslinja held fram med «på veg».
  const moving = renderApp({ initialSanntid: { entries: [aisEntry(0.5, 20000)] } });
  assert.match(statusArea(moving), /Ferja er på veg mot Standal\./);
  assert.equal(mainLine(moving), "På veg mot Standal");
  // Utan AIS: som før.
  assert.match(statusArea(renderApp()), /Ferja er på veg mot Standal\./);
});


test("bunnteksten: kreditering av AIS frå Kystverket (NLOD) og «Om dataa» (samanleggbar) – og fotnoten under ruta har berre rutetinga", async () => {
  const { setLang } = await server.ssrLoadModule("/src/components/i18n.js");
  const html = renderApp({ initialEntur: { live: enturLive(0.7, 10000) }, initialSanntid: { entries: [aisEntry(0.5, 8000)] } });
  const footer = html.slice(html.indexOf('<footer class="site-footer">'));
  assert.match(footer, /<p id="footer-credit">AIS-data frå Kystverket \(NLOD\)\. Sanntidsdata frå Entur\. <a href="https:\/\/[^"]*"[^>]*>NAIS<\/a> · <a href="https:\/\/data\.norge\.no\/nlod\/no\/2\.0"[^>]*>NLOD-lisens<\/a><\/p>/);
  assert.match(footer, /<details class="about-data" id="about-data"><summary>Om dataa<\/summary>/);
  assert.doesNotMatch(footer, /<details[^>]* open/, "lukka frå start");
  assert.match(footer, /<span id="position-note">Posisjonen kjem frå AIS i sanntid no\.<\/span> Rekkjefølgje: AIS når vi har ein fersk posisjon/);
  assert.match(text(footer), /«Live» er ein posisjon yngre enn 1 minutt/);
  assert.match(text(footer), /AIS-data frå Kystverket \(NLOD\), henta via BarentsWatch\./);
  assert.match(footer, /<span id="timetable-updated">/);
  // Fotnoten i rutekortet: ingenting generelt om datakjelder att.
  const note = html.match(/<p class="footnote">.*?<\/p>/s)[0];
  assert.doesNotMatch(note, /AIS frå Kystverket|position-note|timetable-updated|Rutetabellen blir berre lasta/);
  assert.match(note, /Signalturar må tingast på telefon/);
  assert.match(note, /id="timetable-pdf"/);
  // Samtidig står Entur ikkje i «No»-feltet når posisjonen er AIS.
  assert.doesNotMatch(strip(nowArea(html)), /Entur/);
  // nn/en/de: same struktur og kreditering i alle tre.
  for (const [lang, credit, summary] of [["en", "AIS data from Kystverket (NLOD)", "About the data"], ["de", "AIS-Daten von Kystverket (NLOD)", "Über die Daten"]]) {
    await setLang(lang);
    const other = renderApp({ lang, initialSanntid: { entries: [aisEntry(0.5, 8000)] } });
    const f = other.slice(other.indexOf('<footer class="site-footer">'));
    assert.ok(f.includes(`<p id="footer-credit">${credit}`), lang);
    assert.ok(f.includes(`<summary>${summary}</summary>`), lang);
  }
  await setLang("nn");
});

function atTime(ms, render) {
  current = ms;
  try {
    return render();
  } finally {
    current = FIXED;
  }
}


// --- «No»-kortet: kvar ferja er, avgang og overfart. Neste avgang med nedteljing står i statuslinja. ---

test("kortet om natta ved kai: kvar ferja er frå AIS, første tur i morgon med ekte tider; same ordlyd i toppen", () => {
  const html = atTime(oslo(21, 7), () => renderApp({ initialSanntid: { entries: [aisEntry(1, FIXED - oslo(21, 7) + 20000, { sog: 0 })] } }));
  assert.equal(mainLine(html), "Ligg til kai på Standal");
  assert.equal(badgeText(html), "Live frå AIS · 20 s", "kjeldemerket står framleis");
  const lines = supportLines(html);
  assert.match(lines[0], /^plan: Første avgang i morgon \d\d:\d\d til \w+$/);
  assert.match(lines[1], /^trip: Overfart ca\. \d+ min · framme \d\d:\d\d$/);
  assert.match(
    statusArea(html),
    /^<div class="status-area"><p class="lede" id="lede-status">Ferja ligg til kai på Standal\. Første tur i morgon \d\d:\d\d frå \w+, om \d+ t \d+ min( · på signal, ring innan \d\d:\d\d)?\./,
    "toppen og kortet seier same: ligg til kai, første tur i morgon med nedteljing"
  );
  assert.match(sceneOf(html), /na-fill-none is-solid/);
});

test("kortet med AIS ved Standal-kaia seier kvar ferja er frå AIS, òg når tabellen seier noko anna", () => {
  // 20:30: tabellen seier overfart Trandal → Standal (framme 20:35), men AIS viser ferja ved Standal-kaia.
  const html = renderApp({ initialSanntid: { entries: [aisEntry(1, 15000, { sog: 0 })] } });
  assert.equal(mainLine(html), "Ligg til kai på Standal");
  assert.doesNotMatch(strip(nowArea(html)), /på veg/);
  assert.match(statusArea(html), /Ferja ligg til kai på Standal\./);
});

test("kortet dagtid ved kai mellom turar: planlagd avgang og overfart frå turen ferja kan ta", () => {
  const html = atTime(oslo(20, 16), () => renderApp());
  assert.equal(mainLine(html), "Ferja ligg til kai på Trandal");
  assert.deepEqual(supportLines(html), ["plan: Planlagd avgang 20:20 til Standal", "trip: Overfart ca. 15 min · framme 20:35"]);
  assert.match(html, /Ankomst 20:35/, "ankomsten står òg på avgangsrada");
  assert.match(statusArea(html), /Neste avgang 20:20 frå Trandal/);
});

test("kortet på overfart: ferja på linja, fart og framkomst frå tabellen, fylt line", () => {
  const html = renderApp({ initialSanntid: { entries: [aisEntry(0.5, 8000, { sog: 11 })] } });
  assert.equal(mainLine(html), "På veg mot Standal");
  assert.deepEqual(supportLines(html), ["move: 11 knop · framme ca. 20:35"]);
  assert.match(nowArea(html), /<b>11 knop<\/b>/, "tal i feit skrift");
  assert.match(sceneOf(html), /style="--x:0\.5/);
  assert.match(nowArea(html), /<div class="na-quays"><span>Trandal<\/span><span>Standal<\/span><\/div>/);
});

test("kortet: nn, en og de", async () => {
  const { setLang } = await server.ssrLoadModule("/src/components/i18n.js");
  for (const [lang, main, badge, headline] of [
    ["en", "At the quay in Standal", "Live from AIS · 20 s", /First sailing tomorrow \d\d:\d\d from \w+, in \d+ h \d+ min/],
    ["de", "Liegt am Kai in Standal", "Live von AIS · 20 s", /Erste Fahrt morgen \d\d:\d\d ab \w+, in \d+ Std\. \d+ Min\./],
  ]) {
    await setLang(lang);
    const html = atTime(oslo(21, 7), () => renderApp({ lang, initialSanntid: { entries: [aisEntry(1, FIXED - oslo(21, 7) + 20000, { sog: 0 })] } }));
    assert.equal(mainLine(html), main, lang);
    assert.equal(badgeText(html), badge, lang);
    assert.match(text(statusArea(html)), headline, lang);
    assert.match(html, /<h2 class="trips-heading">(Sailings|Fahrten)<\/h2>/);
    assert.match(nowArea(html), /aria-label="(The ferry now|Die Fähre jetzt)"/);
  }
  await setLang("nn");
});

test("CSS: kortet bryt tekst i staden for å klippe, px-polstring, ferje 80–88 px, ingen fast breidd på tekst, reduced motion utan glid og puls", () => {
  const css = readFileSync(new URL("src/styles/nowcard.css", new URL("..", import.meta.url)), "utf8");
  assert.match(css, /--fw: clamp\(80px, 12vw, 120px\)/, "ferja: 80 px på telefon, opptil 120 px på nettbrett");
  const main = css.match(/\.na-main \{[^}]*\}/)[0];
  assert.match(main, /font-size: 1\.0625rem/);
  assert.match(main, /overflow-wrap: break-word/);
  assert.match(css.match(/\.na-support \{[^}]*\}/)[0], /overflow-wrap: break-word/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, "").match(/\.na-(main|support|badge-text|quays) \{[^}]*\}/g).join(" "), /[^-]width:|white-space: nowrap/);
  // Berre transform/opacity/filter blir animert.
  for (const [, props] of css.matchAll(/transition:\s*([^;]+);/g)) {
    for (const part of props.split(",")) assert.match(part.trim(), /^(none$|transform |opacity |filter )/, part);
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.na-badge\[data-fresh="1"\] \.na-badge-icon \{ animation: none; \}[^}]*transition: none;/s);
  // Fargane: grønt berre ved fersk AIS (live/utanfor), oransje berre for forseinking, raudt berre avlyst, blått for «utanfor ruta».
  assert.match(css, /\.na-badge\[data-state="live"\], \.na-badge\[data-state="outside"\] \{ color: var\(--ok-fg\)/);
  assert.match(css, /\.na-support-delay \{ color: var\(--delay-fg\)/);
  assert.match(css, /\.na-support-cancelled \{ color: var\(--stop-fg\)/);
  assert.match(css, /\.na-tag \{[^}]*color: var\(--info-fg\)/s);
  assert.doesNotMatch(css, /fdeee0|var\(--delay\)|--delay-(bg|soft|line)/, "ingen liggetid-oransje og ingen delt bakgrunn i kortet (oransje berre som tekst for forseinking)");
  const ferry = readFileSync(new URL("src/components/FerryV2.jsx", new URL("..", import.meta.url)), "utf8");
  assert.match(ferry, /viewBox="0 0 96 32"/);
  assert.doesNotMatch(ferry, /#[0-9a-f]{3,6}"/i, "ingen faste fargar i SVG-en: fargane kjem frå CSS-variablane");
});

test("natt: fersk AIS ved kai gjev «Live frå AIS» og «ligg til kai på X» frå AIS – og siste kjende etter 4 min", () => {
  const night = oslo(21, 7);
  const fresh = atTime(night, () => renderApp({ initialSanntid: { entries: [aisEntry(1, FIXED - night + 90000, { sog: 0 })] } }));
  assert.equal(badgeText(fresh), "Live frå AIS · 1 min");
  assert.equal(mainLine(fresh), "Ligg til kai på Standal");
  assert.match(statusArea(fresh), /Ferja ligg til kai på Standal\. Første tur i morgon/, "overskrifta og kortet har same ordlyd");
  assert.match(text(fresh), /Posisjonen kjem frå AIS i sanntid no\./);
  assert.doesNotMatch(nowArea(fresh), /na-wake|role="progressbar"/);
  // 6 min gammal AIS ved kai: siste kjende (opptil 15 min), ikkje «live», og kortet påstår ikkje meir enn tabellen.
  const stale = atTime(night, () => renderApp({ initialSanntid: { entries: [aisEntry(1, FIXED - night + 6 * 60000, { sog: 0 })] } }));
  assert.equal(badgeText(stale), "Siste kjende frå AIS · 6 min sidan");
  assert.equal(mainLine(stale), "Ferja er ferdig for dagen på Standal");
  // 20 min gammal: ukjend, rutetabellen.
  const old = atTime(night, () => renderApp({ initialSanntid: { entries: [aisEntry(1, FIXED - night + 20 * 60000, { sog: 0 })] } }));
  assert.match(nowArea(old), /data-state="(unknown|calc)"/);
  assert.doesNotMatch(badgeText(old), /Live/);
});

test("utanfor ruta: kortet og overskrifta seier det, utan ferjelinje, framdrift eller neste tur", () => {
  const far = core.fixFromAis({ mmsi: 257297400, latitude: 62.45, longitude: 6.2, sog: 8, cog: 200, navStatus: 0, timestamp: FIXED - 20000 });
  const html = renderApp({ initialSanntid: { entries: [{ line: "1136", fix: far }] } });
  const now = nowArea(html);
  assert.match(now, /<span class="na-tag">.*Utanfor ruta<\/span>/s);
  assert.equal(mainLine(html), "Ferja er utanfor ruta");
  assert.equal(badgeText(html), "Live frå AIS · 20 s");
  assert.deepEqual(supportLines(html), ["note: AIS-posisjonen ligg utanfor ruta mellom kaiane. Vi viser ingen framdrift og følgjer ikkje rutetabellen."]);
  assert.match(now, /class="na-scene na-scene-outside"/);
  assert.match(now, /class="na-arrow"/, "stipla pil, ingen line mellom kaiane");
  assert.doesNotMatch(now, /na-rail|na-quays|na-pier|na-wake|na-fill/);
  assert.doesNotMatch(strip(now), /Planlagd|Overfart|framme|knop/);
  assert.match(statusArea(html), /Ferja er utanfor ruta\./);
  assert.doesNotMatch(statusArea(html), /på veg mot/);
});

test("fyrste AIS-svar på veg: nøytralt «Hentar posisjon», ikkje «Berekna frå rutetabellen»; lagra posisjon med verkeleg alder", () => {
  // Ingen lagra posisjon og ingen svar enno.
  const pending = renderApp({ initialSanntid: { entries: [], loaded: false } });
  assert.equal(badgeText(pending), "Hentar posisjon …");
  assert.doesNotMatch(nowArea(pending), /Berekna frå rutetabellen/);
  assert.match(nowArea(pending), /data-state="loading"/);
  // Lagra posisjon (3 min gamal, på overfart): «Siste kjende frå AIS · 3 min sidan» med ein gong, med den verkelege alderen.
  const cached = renderApp({ initialSanntid: { entries: [aisEntry(0.4, 3 * 60000)], loaded: false } });
  assert.equal(badgeText(cached), "Siste kjende frå AIS · 3 min sidan");
  assert.doesNotMatch(nowArea(cached), /Hentar posisjon|Berekna frå rutetabellen/);
  // Svaret er komme, men utan posisjon: då er det ærleg «Berekna frå rutetabellen».
  const loaded = renderApp({ initialSanntid: { entries: [], loaded: true } });
  assert.equal(badgeText(loaded), "Berekna frå rutetabellen");
  // Lagra posisjon som er for gamal til å stolast på: nøytralt medan svaret er på veg, så ærleg «Berekna frå rutetabellen» når svaret er komme.
  const old = renderApp({ initialSanntid: { entries: [aisEntry(0.4, 40 * 60000)], loaded: false } });
  assert.equal(badgeText(old), "Hentar posisjon …");
  const oldLoaded = renderApp({ initialSanntid: { entries: [aisEntry(0.4, 40 * 60000)], loaded: true } });
  assert.equal(badgeText(oldLoaded), "Berekna frå rutetabellen");
  // Andre språk.
  assert.equal(badgeText(renderApp({ lang: "en", initialSanntid: { entries: [], loaded: false } })), "Getting position …");
  assert.equal(badgeText(renderApp({ lang: "de", initialSanntid: { entries: [], loaded: false } })), "Position wird geladen …");
});

test("kortet: live AIS ved kai er den vanlege grøne stilen – ingen liggetid-oransje og ingen delt bakgrunn", () => {
  const t = oslo(7, 25);
  const css = readFileSync(new URL("src/styles/nowcard.css", new URL("..", import.meta.url)), "utf8");
  // Utan AIS: berekna, nøytralt grått (dempa), ikkje grønt og ikkje oransje.
  const calc = atTime(t, () => renderApp());
  assert.match(nowArea(calc), /data-state="calc"/);
  // Fersk AIS ved kai (Standal eller Trandal): grønt merke, same ærlege kjeldemerke, ingen fyll.
  for (const f of [0, 1]) {
    const html = atTime(t, () => renderApp({ initialSanntid: { entries: [aisEntry(f, FIXED - t + 15000, { sog: 0 })] } }));
    const now = nowArea(html);
    assert.match(now, /class="na na-moored na-state-live"/, `AIS ved kai ${f}`);
    assert.match(now, /<span class="na-badge" data-state="live"/);
    assert.match(sceneOf(html), /na-fill-none is-solid/, "ingen fyll ved kai");
    assert.doesNotMatch(now, /is-layover|has-progress|now-track|now-fill|--now-progress|na-support-delay/);
    assert.equal(badgeText(html), "Live frå AIS · 15 s");
  }
  assert.match(css, /\.na-state-live \{ border-color: var\(--na-live-line\); \}/);
  assert.match(css, /--na-live-line: #b8dccf;/, "lyst tema: grøn kant ved live");
  assert.doesNotMatch(css, /\.na-(moored|state-live)[^{]*\{[^}]*(fdeee0|8f4a0c|delay)/);
});
