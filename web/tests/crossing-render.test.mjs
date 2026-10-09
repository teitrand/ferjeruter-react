// Teiknetestar for sanntidsdelane: live-merket, framdriftslinja med ferja, nedteljinga og
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
let CrossingView;
let Countdown;
let AnnouncerProvider;
let memoryOnly;
let core;

before(async () => {
  server = await createServer({
    root,
    configFile: fileURLToPath(new URL("../vite.config.js", import.meta.url)),
    logLevel: "error",
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  ({ App } = await server.ssrLoadModule("/src/App.jsx"));
  ({ CrossingView } = await server.ssrLoadModule("/src/components/LiveCrossing.jsx"));
  ({ Countdown } = await server.ssrLoadModule("/src/components/Countdown.jsx"));
  ({ AnnouncerProvider } = await server.ssrLoadModule("/src/components/Announcer.jsx"));
  ({ memoryOnly } = await server.ssrLoadModule("/src/model/context.js"));
  core = await server.ssrLoadModule("/../packages/core/index.js");
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
const LEG = { id: "x", from: "Trandal", to: "Standal", departure: "20:20:00", arrival: "20:35:00" };

function view(fix, nowMs = FIXED) {
  return core.crossingView({ leg: LEG, fix, nowMs });
}

function aisAt(f, at) {
  const a = core.QUAY_COORDS.Trandal;
  const b = core.QUAY_COORDS.Standal;
  return core.fixFromAis({
    mmsi: 257297400,
    latitude: a.latitude + (b.latitude - a.latitude) * f,
    longitude: a.longitude + (b.longitude - a.longitude) * f,
    sog: 11,
    cog: 270,
    timestamp: at,
  });
}

function draw(element, lang = "nn") {
  core.setLang?.(lang);
  return clean(renderToString(element));
}

test("live-overfart: éi linje der framdrift og ferje ligg saman, progressbar med kjelde, heil linje, puls", async () => {
  const { setLang } = await server.ssrLoadModule("/src/components/i18n.js");
  setLang("nn");
  const html = clean(renderToString(createElement(CrossingView, { view: view(aisAt(0.62, FIXED - 12000)) })));
  assert.match(html, /class="crossing is-ready" data-source="measured" data-line="solid" style="--p:0\.6\d*"/);
  assert.match(html, /class="live" data-state="live" data-fresh="1"/);
  assert.match(text(html), /Live frå AIS · 12 s/);
  assert.match(html, /role="progressbar" aria-label="Overfarten Trandal → Standal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="60" aria-valuetext="60 % av overfarten frå Trandal til Standal, målt med AIS"/);
  // Éi linje: spor, fyll, kaiane og ferja er alle inne i same progressbar.
  const line = html.slice(html.indexOf('class="ferry-line"'), html.indexOf('class="line-labels"'));
  assert.match(line, /role="progressbar"/);
  for (const part of ["line-track", "quay a", "quay b", "ferry-runner"]) {
    assert.match(line, new RegExp(`class="${part}"`), part);
  }
  assert.doesNotMatch(html, /line-fill/, "ingen eigen framdriftsstolpe: ferja er framdrifta");
  assert.match(line, /<svg class="ferry" viewBox="0 0 36 18" focusable="false" aria-hidden="true"/);
  assert.equal((html.match(/role="progressbar"/g) || []).length, 1, "berre éi linje");
  assert.doesNotMatch(html, /rail-wrap|progress-track/, "ingen eiga ferjelinje under ein progressbar");
  assert.match(html, /class="line-labels" aria-hidden="true"><span>Trandal<\/span><span>Standal<\/span>/);
  assert.match(text(html), /Posisjon målt med AIS frå Kystverket\./);
  assert.doesNotMatch(html, /aria-live/, "ingen live-region per overfart");
});

test("mindre rørsle: ingen puls, data-motion=reduce, ingen overgang før fyrste frame", async () => {
  const html = clean(
    renderToString(createElement(CrossingView, { view: view(aisAt(0.5, FIXED - 5000)), reducedMotion: true, animate: false }))
  );
  assert.match(html, /class="crossing" data-source="measured" data-line="solid" data-motion="reduce"/);
  assert.doesNotMatch(html, /data-fresh/);
  const css = readFileSync(new URL("src/styles/crossing.css", new URL("..", import.meta.url)), "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root \{ --dur-position: 0ms; --dur-status: 0ms; --dur-fade: 0ms; \}/);
  // Berre transform og opacity blir animert.
  for (const [, props] of css.matchAll(/transition:\s*([^;]+);/g)) {
    for (const part of props.split(",")) assert.match(part.trim(), /^(transform|opacity|filter) /, part);
  }
  // Ferja glir med transform (translateX), aldri scaleX, og det finst ingen framdriftsstolpe å fylle.
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /scaleX|line-fill/);
  assert.match(css, /\.ferry-runner \{[^}]*transform: translateX\(calc\(var\(--p, 0\) \* 100%\)\)/);
  assert.match(css, /\.crossing\.is-ready \.ferry-runner \{\s*transition: transform var\(--dur-position\) var\(--ease-position\);/);
});

test("siste kjende, ukjent og berekna: grått, ærleg merka", async () => {
  const { setLang } = await server.ssrLoadModule("/src/components/i18n.js");
  setLang("nn");
  const fix = aisAt(0.4, FIXED - 3 * 60000);
  const stale = clean(renderToString(createElement(CrossingView, { view: view(fix) })));
  assert.match(stale, /data-source="stale" data-line="dashed"/);
  assert.match(stale, /class="live" data-state="stale">/);
  assert.match(text(stale), /Siste kjende frå AIS · 3 min sidan/);
  assert.match(stale, /aria-valuetext="[^"]*, siste kjende posisjon, frå AIS"/);

  const unknown = clean(renderToString(createElement(CrossingView, { view: view(aisAt(0.2, oslo(20, 22))) })));
  assert.match(unknown, /data-source="unknown" data-line="dashed"/);
  assert.match(text(unknown), /Ukjent · ingen sanntid sidan 20:22/);
  assert.match(text(unknown), /Vi veit ikkje kvar ferja er no\. Posisjonen er berre rekna ut frå rutetabellen\./);
  // Gammal posisjon: framdrifta er rutetabellen (65 %), merkt som anslag.
  assert.match(text(unknown), /ca\. 67 % av overfarten · planlagt framme 20:35/);
  assert.match(unknown, /aria-valuetext="65 % av overfarten frå Trandal til Standal, posisjon ukjend, berekna frå rutetabellen"/);

  const calc = clean(renderToString(createElement(CrossingView, { view: view(null) })));
  assert.match(calc, /data-source="calc" data-line="dashed"/);
  assert.match(text(calc), /Berekna frå rutetabellen/);
  assert.match(calc, /aria-valuetext="65 % av overfarten frå Trandal til Standal, berekna frå rutetabellen"/);
  assert.match(text(calc), /Posisjonen er berre rekna ut frå rutetabellen\./);
  assert.match(text(calc), /ca\. 67 % av overfarten · planlagt framme 20:35/);
  assert.match(calc, /class="ferry-approx" aria-hidden="true">≈</);
  const css = readFileSync(new URL("src/styles/crossing.css", new URL("..", import.meta.url)), "utf8");
  assert.match(css, /\.crossing\[data-line="dashed"\] \.line-track \{\s*background: repeating-linear-gradient/);
  assert.match(css, /\.crossing\[data-line="solid"\] \.line-track \{\s*background: var\(--fill-measured\)/);
});

test("engelsk og tysk", async () => {
  const { setLang } = await server.ssrLoadModule("/src/components/i18n.js");
  setLang("en");
  assert.match(text(clean(renderToString(createElement(CrossingView, { view: view(null) })))), /Estimated from the timetable/);
  setLang("de");
  assert.match(clean(renderToString(createElement(CrossingView, { view: view(null) }))), /aria-valuetext="65 % der Überfahrt von Trandal nach Standal, aus dem Fahrplan berechnet"/);
  setLang("nn");
});

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
/** «No»-raden i tidslinja: heimen til kjeldemerket og ferjelinja. Går fram til neste rad. */
function nowArea(html) {
  const i = html.indexOf('<div class="now ');
  if (i < 0) return "";
  const rest = html.slice(i);
  const next = rest.slice(10).search(/<div class="stop|<p class="footnote"|<\/section>/);
  return next < 0 ? rest : rest.slice(0, next + 10);
}

test("appen: statuslinja øvst, sanntida i «No»-raden – ferja er framdrifta, ingen eigen stolpe", () => {
  const html = renderApp();
  assert.equal((html.match(/data-announcer=""/g) || []).length, 1, "éin live-region for sanntid");
  const head = statusArea(html);
  assert.match(head, /<p class="lede" id="lede-status">Ferja er på veg mot Standal\. /, "teksten kjem frå currentStatus, som før");
  assert.doesNotMatch(head, /class="live"|class="crossing|role="progressbar"/, "ingen sanntidsboks øvst");
  const now = nowArea(html);
  assert.match(now, /^<div class="now is-underway now-live has-crossing" role="group" aria-label="No">/);
  assert.match(now, /<div class="now-head"><span class="now-label">No<\/span><span class="live" data-state="calc">/);
  assert.match(now, /class="crossing" data-source="calc" data-line="dashed"/);
  assert.match(now, /aria-valuetext="65 % av overfarten frå Trandal til Standal, berekna frå rutetabellen"/);
  assert.match(text(now), /Berekna frå rutetabellen/);
  assert.match(now, /<svg class="ferry"/, "ferja ligg på linja");
  assert.doesNotMatch(now, /now-track|now-fill|has-progress/, "ingen separat framdriftsstolpe");
  assert.equal((html.match(/class="crossing[ "]/g) || []).length, 1);
  assert.doesNotMatch(html, /class="now-text"/);
});

test("appen: Entur-posisjon midt på fjorden gjev målt framdrift; ekte VM ved kai gjev ingen overfart", () => {
  // Den ekte meldinga: ferja kom til Standal 20:30:45, før rutetida. Då er overfarten over.
  const arrived = renderApp({ initialEntur: { live: { ...core.parseVehicleMonitoring(VM), validUntil: "2099-01-01T00:00:00Z" } } });
  assert.doesNotMatch(arrived, /class="crossing/);
  // Same melding, flytta ut på fjorden 10 s før «no» (syntetisk).
  const message = structuredClone(VM);
  const activity = message.Siri.ServiceDelivery.VehicleMonitoringDelivery[0].VehicleActivity[0];
  activity.RecordedAtTime = new RealDate(FIXED - 10000).toISOString();
  activity.ValidUntilTime = new RealDate(FIXED + 110000).toISOString();
  const call = activity.MonitoredVehicleJourney.MonitoredCall;
  call.VehicleAtStop = false;
  delete call.ActualArrivalTime;
  const a = core.QUAY_COORDS.Trandal;
  const b = core.QUAY_COORDS.Standal;
  activity.MonitoredVehicleJourney.VehicleLocation = {
    Latitude: a.latitude + (b.latitude - a.latitude) * 0.7,
    Longitude: a.longitude + (b.longitude - a.longitude) * 0.7,
  };
  const html = renderApp({ initialEntur: { live: core.parseVehicleMonitoring(message) } });
  assert.match(html, /class="crossing" data-source="measured" data-line="solid"/);
  assert.match(html, /class="live" data-state="live" data-fresh="1"/);
  assert.match(text(html), /Live frå Entur · 10 s/);
  assert.match(html, /aria-valuetext="70 % av overfarten frå Trandal til Standal, målt, frå sanntid hos Entur"/);
});

test("appen: ved kai er det statuslinja med tikkande nedteljing, og «No»-raden har stolpen utan ferje", () => {
  current = oslo(20, 16);
  try {
    const html = renderApp();
    const head = statusArea(html);
    assert.match(
      head,
      /<p class="lede" id="lede-status">Ferja ligg til kai på Trandal\. Neste avgang 20:20 frå Trandal, <span class="countdown"><span class="countdown-text is-tabular" aria-hidden="true">om 4:00<\/span><span class="visually-hidden">om 4 min<\/span><\/span>\./
    );
    const now = nowArea(html);
    assert.doesNotMatch(now, /class="crossing|class="ferry|role="progressbar"/, "ingen ferje og ingen ferjelinje ved kai");
    assert.match(now, /^<div class="now is-moored has-progress now-live" style="--now-progress:\d+%" role="group" aria-label="No"><span class="now-track" aria-hidden="true"><span class="now-fill"><\/span><\/span>/);
    assert.match(now, /<span class="now-label">No<\/span><span class="live" data-state="calc">/);
    assert.match(text(now), /Berekna frå rutetabellen/);
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

test("appen: AIS er sanninga – live frå AIS vinn over ein Entur-posisjon, og ingenting i «No»-feltet eller toppen seier Entur", () => {
  const html = renderApp({ initialEntur: { live: enturLive(0.7, 10000) }, initialSanntid: { entries: [aisEntry(0.5, 8000)] } });
  const area = nowArea(html);
  assert.match(area, /class="crossing" data-source="measured" data-line="solid"/);
  assert.match(text(area), /Live frå AIS · 8 s/);
  assert.match(area, /aria-valuetext="50 % av overfarten frå Trandal til Standal, målt med AIS"/);
  assert.match(text(area), /Posisjon målt med AIS frå Kystverket\./);
  assert.doesNotMatch(text(area), /Entur/);
  assert.doesNotMatch(area, /aria-[a-z]+="[^"]*Entur/);
  assert.equal(footnote(html), "Posisjonen kjem frå AIS i sanntid no.");
});

test("appen: berre AIS (Entur utan posisjon) gjev ei heil linje og live frå AIS", () => {
  const html = renderApp({ initialSanntid: { entries: [aisEntry(0.4, 20000)] } });
  const area = nowArea(html);
  assert.match(area, /data-source="measured" data-line="solid"/);
  assert.match(text(area), /Live frå AIS · 20 s/);
  assert.doesNotMatch(text(area), /Entur/);
  assert.equal(footnote(html), "Posisjonen kjem frå AIS i sanntid no.");
});

test("appen: AIS er gammal og Entur live – då er Entur kjelda, og det står Entur, ikkje AIS", () => {
  const html = renderApp({ initialEntur: { live: enturLive(0.7, 10000) }, initialSanntid: { entries: [aisEntry(0.3, 2 * 60000)] } });
  const area = nowArea(html);
  assert.match(text(area), /Live frå Entur · 10 s/);
  assert.match(area, /aria-valuetext="70 % av overfarten frå Trandal til Standal, målt, frå sanntid hos Entur"/);
  assert.doesNotMatch(text(area), /AIS/);
  assert.equal(footnote(html), "Posisjonen kjem frå Entur i sanntid no.");
});

test("appen: siste kjende AIS utan Entur er stipla og seier AIS; for gammal er ukjend; verken Entur eller AIS", () => {
  const stale = renderApp({ initialSanntid: { entries: [aisEntry(0.4, 3 * 60000)] } });
  const area = nowArea(stale);
  assert.match(area, /data-source="stale" data-line="dashed"/);
  assert.match(text(area), /Siste kjende frå AIS · 3 min sidan/);
  assert.match(area, /aria-valuetext="[^"]*, siste kjende posisjon, frå AIS"/);
  assert.match(text(area), /Siste AIS-posisjon kl\. 20:27\./);
  assert.doesNotMatch(text(area), /Entur/);
  const unknown = nowArea(renderApp({ initialSanntid: { entries: [aisEntry(0.4, 8 * 60000)] } }));
  assert.match(unknown, /data-source="unknown" data-line="dashed"/);
  assert.match(text(unknown), /Ukjent · ingen sanntid sidan 20:22/);
  assert.doesNotMatch(text(unknown), /AIS|Entur/);
});

test("appen: workeren nede og ingen Entur – rutetabellen, stipla, ærleg merka (ingen feilmelding)", () => {
  const html = renderApp({ initialSanntid: { entries: [], failed: true } });
  const area = nowArea(html);
  assert.match(area, /data-source="calc" data-line="dashed"/);
  assert.match(text(area), /Berekna frå rutetabellen/);
  assert.doesNotMatch(text(area), /AIS|Entur/);
  assert.equal(footnote(html), "Ingen sanntidsposisjon frå AIS eller Entur no.");
  // Same utan svar frå workeren, men Entur har ein posisjon: Entur er kjelda.
  const withEntur = renderApp({ initialEntur: { live: enturLive(0.7, 10000) }, initialSanntid: { entries: [], failed: true } });
  assert.match(text(nowArea(withEntur)), /Live frå Entur · 10 s/);
});

test("appen: AIS frå ei anna linje (1135) blir ikkje brukt for 1136", () => {
  const html = renderApp({ initialSanntid: { entries: [aisEntry(0.5, 5000, { line: "1135", mmsi: 257262400 })] } });
  const area = nowArea(html);
  assert.match(area, /data-source="calc"/);
  assert.doesNotMatch(text(area), /AIS/);
});

test("appen: utan AIS-kjelda (sanntid av) er teksten som før og Entur-notat uendra", () => {
  const html = renderApp({ initialEntur: { live: enturLive(0.7, 10000) } });
  assert.match(text(nowArea(html)), /Live frå Entur · 10 s/);
  assert.equal(footnote(html), "Posisjonen kjem frå Entur i sanntid no.");
});

test("appen: AIS ved kai mot rutetabellen sin «på veg» – statuslinja og «No»-raden er samde, utan ferje", () => {
  const entry = aisEntry(1, 20000, { sog: 0 });
  const html = renderApp({ initialSanntid: { entries: [entry] } });
  const head = statusArea(html);
  assert.match(head, /<p class="lede" id="lede-status">Ferja ligg til kai på Standal\./);
  assert.doesNotMatch(head, /på veg/);
  const now = nowArea(html);
  assert.match(text(now), /Live frå AIS · 20 s/);
  assert.doesNotMatch(now, /class="ferry|class="crossing|role="progressbar"/, "ved kai: stolpen utan ferje");
  assert.match(now, /^<div class="now is-moored now-live" role="group" aria-label="No">/);
  // Same ferje i fart midt på fjorden: statuslinja held fram med «på veg», med ferja på linja.
  const moving = renderApp({ initialSanntid: { entries: [aisEntry(0.5, 20000)] } });
  assert.match(statusArea(moving), /Ferja er på veg mot Standal\./);
  assert.match(nowArea(moving), /<svg class="ferry"/);
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
  assert.doesNotMatch(text(nowArea(html)), /Entur/);
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

// --- Teksten i «No»-raden: kvar ferja er, neste tur, overfartstid, turen etter ---

const infoLines = (html) => [...nowArea(html).matchAll(/<li class="now-info-(\w+)">([^<]*)<\/li>/g)].map((m) => `${m[1]}: ${m[2]}`);

function atTime(ms, render) {
  current = ms;
  try {
    return render();
  } finally {
    current = FIXED;
  }
}

test("«No»-raden om natta ved kai: kvar ferja er, fyrste tur i morgon, nedteljing, overfartstid, turen etter", () => {
  const html = atTime(oslo(21, 7), () => renderApp({ initialSanntid: { entries: [aisEntry(1, FIXED - oslo(21, 7) + 20000, { sog: 0 })] } }));
  const now = nowArea(html);
  assert.match(now, /^<div class="now is-moored now-live" role="group" aria-label="No">/);
  assert.match(text(now), /Live frå AIS · 20 s/, "kjeldemerket står framleis");
  assert.match(now, /<ul class="now-info">/);
  const lines = infoLines(html);
  assert.match(lines[0], /^place: Ferja (ligg til kai|er ferdig for dagen) på (Standal|Trandal)$/);
  assert.match(lines[1], /^next: Første tur i morgon \d\d:\d\d frå \w+, om \d+ t \d+ min( · på signal)?$/);
  assert.match(lines[2], /^trip: Overfarta tek \d+ min, framme \d\d:\d\d$/);
  assert.match(lines[3], /^then: Deretter \d\d:\d\d frå \w+$/);
  assert.doesNotMatch(now, /class="ferry|role="progressbar"/, "ved kai: ingen ferje");
});

test("«No»-raden med AIS ved Standal-kaia seier kvar ferja er frå AIS, òg når tabellen seier noko anna", () => {
  // 20:30: tabellen seier overfart Trandal → Standal (framme 20:35), men AIS viser ferja ved Standal-kaia.
  const html = renderApp({ initialSanntid: { entries: [aisEntry(1, 15000, { sog: 0 })] } });
  const lines = infoLines(html);
  assert.equal(lines[0], "place: Ferja ligg til kai på Standal");
  assert.doesNotMatch(lines.join(" "), /på veg/);
  assert.match(statusArea(html), /Ferja ligg til kai på Standal\./);
});

test("«No»-raden dagtid ved kai mellom turar: neste avgang med nedteljing, overfartstid og turen etter", () => {
  const html = atTime(oslo(20, 16), () => renderApp());
  const lines = infoLines(html);
  assert.equal(lines[0], "place: Ferja ligg til kai på Trandal");
  assert.match(lines[1], /^next: Neste avgang 20:20 frå Trandal, om 4 min/);
  assert.equal(lines[2], "trip: Overfarta tek 15 min, framme 20:35");
  // Same dag, nokre veker seinare i tabellen: «Neste avgang» står òg i toppen, men «No»-raden er ferdig for seg.
  assert.match(nowArea(html), /Berekna frå rutetabellen/);
});

test("«No»-raden på overfart: ferja på linja, minutt att til framkomst og kvar ferja skal", () => {
  const html = renderApp({ initialSanntid: { entries: [aisEntry(0.5, 8000, { sog: 11 })] } });
  const now = nowArea(html);
  assert.match(now, /<svg class="ferry"/);
  assert.match(text(now), /Live frå AIS · 8 s/);
  assert.match(text(now), /av overfarten · Framme 20:35 · om 5 min/);
  const lines = infoLines(html);
  assert.equal(lines[0], "place: Ferja er på veg mot Standal");
  assert.match(lines[1], /^then: Første tur i morgon \d\d:\d\d frå \w+( · på signal)?$/, "siste tur i dag: seier kva som kjem i morgon");
});

test("«No»-raden: nn, en og de, og ingen tekst utan tabell", async () => {
  const { setLang } = await server.ssrLoadModule("/src/components/i18n.js");
  for (const [lang, pattern] of [
    ["en", /^next: First sailing tomorrow \d\d:\d\d from \w+, in \d+ h \d+ min/],
    ["de", /^next: Erste Fahrt morgen \d\d:\d\d ab \w+, in \d+ Std\. \d+ Min\./],
  ]) {
    await setLang(lang);
    const html = atTime(oslo(21, 7), () => renderApp({ lang }));
    assert.match(infoLines(html)[1], pattern, lang);
  }
  await setLang("nn");
});

test("«No»-raden: tekst utan overflyt – brotne ord, ingen fast breidd, liste utan punkt", () => {
  const css = readFileSync(new URL("src/styles/crossing.css", new URL("..", import.meta.url)), "utf8");
  const rule = css.match(/\.now-info \{[^}]*\}/)[0];
  assert.match(rule, /list-style: none/);
  assert.match(rule, /overflow-wrap: break-word/);
  assert.doesNotMatch(rule, /(^|[^-])width:|white-space: nowrap|px/, "ingen fast breidd, ingen px: skrifta følgjer rem");
});
