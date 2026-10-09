// Røykjetest for React-skalet: teiknar <App> på tenarsida med fast data og fast klokke,
// utan nett. Lastar komponentane gjennom Vite (same tillegg som byggjet, inkl. ?v=-fjerninga).
// Køyr: npm test -w web (krev npm ci).
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
const KOMBI = json("data/kombirute.json");

// 8. oktober 2026 kl. 20:30 i Oslo (UTC+2).
let FIXED = Date.UTC(2026, 9, 8, 18, 30);
const RealDate = Date;

let server;
let App;
let memoryOnly;

before(async () => {
  server = await createServer({
    root,
    configFile: fileURLToPath(new URL("../vite.config.js", import.meta.url)),
    logLevel: "error",
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  ({ App } = await server.ssrLoadModule("/src/App.jsx"));
  ({ memoryOnly } = await server.ssrLoadModule("/src/model/context.js"));
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [FIXED]));
    }
    static now() {
      return FIXED;
    }
  };
});

after(async () => {
  globalThis.Date = RealDate;
  await server?.close();
});

function render({
  lang = "nn",
  override = null,
  kombirute = null,
  date = null,
  log = true,
  initialEntur = null,
  messages = null,
  connections = null,
  ui = {},
} = {}) {
  const signalLog = log ? { days: { "2026-10-08": LOG.days["2026-10-08"] } } : null;
  const initialData = { routes: ROUTES, kombirute, messages, signalLog, connections };
  const initialState = { routeChoice: "1136", lang, override, date, showPast: true, ...ui };
  const html = renderToString(createElement(App, { initialData, initialEntur, initialState, memory: memoryOnly() }));
  return html.replace(/<!-- -->/g, "");
}

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("skalet teiknar 1136 på nynorsk med statuslinje, dag og «Ukjent»", () => {
  const html = render();
  const plain = text(html);
  assert.match(plain, /Torsdag 8\. oktober/);
  assert.match(html, /id="route-title">Standal–Trandal–Sæbø–Skår–Valderøya–Store Kalvøy</);
  assert.match(html, /class="lede" id="lede-status">Ferja [^<]+\./, "statuslinja har tekst");
  assert.match(html, /class="stop-state" data-signal="unknown">Ukjent</);
  assert.match(plain, /Gått/);
  assert.match(html, /class="chip is-active" aria-pressed="true">Standal–Trandal</);
  assert.ok((html.match(/class="stop stop-dep/g) || []).length > 10, "mange avgangar");
});

test("engelsk: core og komponentane deler éin i18n-modul", () => {
  const plain = text(render({ lang: "en" }));
  // headingDay og countdown kjem frå core; «Unknown» og «Choose route» frå komponentane.
  assert.match(plain, /Thursday 8 October/);
  assert.match(plain, /Unknown/);
  assert.match(plain, /Choose route/);
  assert.doesNotMatch(plain, /Torsdag|Ukjent|Vel samband/);
});

test("kombirute med ?rute=kombi og ein annan dag", () => {
  const html = render({ override: "kombi", kombirute: KOMBI, date: "2026-10-09" });
  assert.match(html, /id="route-badge" class="route-badge">Kombirute</);
  assert.match(html, /id="route-title">Sæbø–Leknes–Skår–Trandal–Standal</);
  assert.match(text(html), /Fredag 9\. oktober/);
  assert.doesNotMatch(html, /data-signal="unknown"/, "andre dagar har ikkje «Ukjent»");
});

// Entur 8. oktober 20:30: 20:20-turen avlyst, men VM viser ferja ved Standal.
const VM = json("tests/fixtures/vm_2026-10-08_2030.json");
const BACK_2020 = "MOR:ServiceJourney:1136_129_9150000046366348";

/** Statusen i rada for 20:20-avgangen frå Trandal (siste ordet før neste rad). */
function state2020(html) {
  return text(html).match(/20:20 Trandal → Standal .*? (Ukjent|Gått|Ikkje utført|Avlyst|Bestilt|På signal) No /)?.[1];
}

test("Entur-bevis: avlyst utan sanntid gjev «Ikkje utført», sanntid som viser turen gjev «Gått»", async () => {
  const { parseVehicleMonitoring } = await server.ssrLoadModule("/../packages/core/index.js");
  const cancelled = { cancelledJourneys: new Set([BACK_2020]) };
  const without = state2020(render({ log: false }));
  const avlyst = state2020(render({ log: false, initialEntur: cancelled }));
  const live = { ...parseVehicleMonitoring(VM), validUntil: "2099-01-01T00:00:00Z" };
  const gone = state2020(render({ log: false, initialEntur: { ...cancelled, live } }));
  assert.deepEqual([without, avlyst, gone], ["Ukjent", "Ikkje utført", "Gått"]);
});

const CONNECTIONS = json("data/korrespondanse.json");
const MESSAGES = {
  fetchedAt: "2026-10-08T06:00:00Z",
  messages: [
    { id: "a", heading: "Standal–Trandal", text: "Forseinking på rute 1136.", severity: "delay", isLocal: true, publishedAt: "2026-10-08T05:00:00Z", connectionNumber: 132 },
    { id: "b", heading: "Sæbø–Leknes", text: "Innstilt avgang 1135.", severity: "cancelled", isLocal: true, publishedAt: "2026-10-08T05:30:00Z", connectionNumber: 134 },
  ],
};

test("meldingspanelet: stripe med tal og utdrag, detaljar når det er ope", () => {
  const closed = render({ messages: MESSAGES });
  assert.match(closed, /<div class="layout" id="layout">/);
  assert.match(closed, /class="messages-bar is-delay" aria-expanded="false"/);
  assert.match(closed, /class="messages-count"[^>]*>2</);
  assert.match(text(closed), /Forseinking på rute 1136\./);
  assert.match(closed, /id="messages-details" class="messages-details" hidden=""/);
  const open = render({ messages: MESSAGES, ui: { messagesExpanded: true } });
  assert.doesNotMatch(open, /id="messages-details"[^>]*hidden/);
  assert.match(open, /<article class="card is-cancelled">/);
  assert.match(open, /data-filter="route" aria-pressed="false">Rute 1136</);
  const none = render();
  assert.match(none, /<div class="layout is-single" id="layout">/);
  assert.doesNotMatch(none, /messages-panel/);
});

test("frå/til, ankomsttider og korrespondanse: kontrollar og rader", () => {
  const html = render({ connections: CONNECTIONS, ui: { filters: { from: "Standal", to: "Leknes" }, connection: "solavagen" } });
  assert.match(html, /<select id="from-stop" class="place-select has-value">/);
  assert.match(html, /<option value="Standal" selected="">Standal<\/option>/);
  assert.match(html, /class="swap-dir"[^>]*>/);
  assert.doesNotMatch(html, /class="swap-dir"[^>]*disabled/);
  assert.match(html, /class="stop stop-dep[^"]*stop-onward/, "vidare med 1135 etter overgang");
  assert.match(html, /class="stop stop-layover stop-wait stop-onward/);
  assert.match(html, /class="conn-select has-value"/);
  assert.match(html, /<span id="connection-note">[^<]+<\/span>/);
  assert.match(html, /class="chip chip-small is-active" aria-pressed="true">Ankomsttider</);
  const hidden = render({ ui: { hideArrivals: true } });
  assert.match(hidden, /class="chip chip-small" aria-pressed="false">Ankomsttider</);
  assert.doesNotMatch(hidden, /stop-eta/);
});

test("avgangane opnar detaljvindauget", () => {
  const html = render();
  assert.match(html, /<button type="button" class="stop-name stop-detail" aria-haspopup="dialog" aria-controls="departure-dialog">/);
  assert.match(html, /<dialog id="departure-dialog" class="install-dialog departure-dialog"/);
});

test("tysk: språkknapp, dato og status på tysk", () => {
  const html = render({ lang: "de" });
  const plain = text(html);
  assert.match(plain, /Donnerstag, 8\. Oktober|Donnerstag 8\. Oktober/);
  assert.match(plain, /Unbekannt/);
  assert.match(html, /class="lang-btn is-active" lang="de"[^>]*aria-pressed="true"/);
  assert.doesNotMatch(plain, /Torsdag|Ukjent/);
});

test("avlyst signaltur framfor oss står som «Avlyst», ikkje «Ikkje utført»", () => {
  const saved = FIXED;
  FIXED = Date.UTC(2026, 9, 8, 6, 25); // 08:25 i Oslo
  try {
    const cancelled = { cancelledJourneys: new Set(["MOR:ServiceJourney:1136_108_9150000046319006"]) };
    const plain = text(render({ log: false, initialEntur: cancelled }));
    assert.match(plain, /08:35 \S+ → \S+ .*?Avlyst/);
    assert.doesNotMatch(plain.match(/08:35 .*?(?=\d\d:\d\d )/)?.[0] || "", /Ikkje utført/);
  } finally {
    FIXED = saved;
  }
});

test("fotnote, botn, install- og tilbakemeldingsvindauge som i vanilla", () => {
  const html = render();
  assert.match(html, /<span id="position-note">Entur har ingen posisjon for ferja no\./);
  assert.match(html, /id="timetable-pdf" href="https:\/\/www\.fjord1\.no\/ruteoversikt\/moere-og-romsdal\/standal-trandal-valderoeya-store-kalvoey\/\(page\)\/pdf"/);
  assert.match(html, /<a href="https:\/\/frammr\.no\/"[^>]*>frammr\.no<\/a>/);
  assert.match(html, /id="footnote-nais"[^>]*>M\/F Kvernes på NAIS</);
  assert.match(html, /id="footer-operator">Operatør Fjord1.*?<a class="footer-phone" aria-label="[^"]+" href="tel:\+4791669340">916 69 340<\/a>/);
  assert.match(html, /<button type="button" id="feedback-open" class="feedback-link">Gje tilbakemelding<\/button>/);
  assert.match(html, /<dialog id="feedback-dialog"[^>]*>.*data-rating="yes".*data-rating="no".*id="feedback-github" href="https:\/\/github\.com\/teitrand\/fergeruter\/issues\/new"/s);
  assert.match(html, /<dialog id="install-dialog"[^>]*>.*data-install-hint="ios".*data-install-hint="android".*data-install-hint="desktop"/s);
  assert.match(html, /class="install-steps is-likely" data-install-hint="desktop" aria-current="true"/);
  // Install-knappen er skjult utan nettlesar (SSR/testar), som i ein installert app.
  assert.match(html, /<button type="button" id="install-btn" class="install-btn" hidden=""/);
  const de = render({ lang: "de" });
  assert.match(de, /id="feedback-open" class="feedback-link">[^<]*Feedback/);
  const k = render({ override: "kombi", kombirute: KOMBI, date: "2026-10-09" });
  assert.match(k, new RegExp(`id="timetable-pdf" href="${(KOMBI.source || "https://frammr.no/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 40)}`));
});

test("siste samband i dag gjev rett tittel før data er lasta (ingen blink)", () => {
  const html = renderToString(
    createElement(App, { lastMode: "kombi", initialState: { routeChoice: "1136", lang: "nn" }, memory: memoryOnly() })
  ).replace(/<!-- -->/g, "");
  assert.match(html, /<header class="site-header">/, "ikkje is-pending-route");
  assert.match(html, /id="route-title">Sæbø–Leknes–Skår–Trandal–Standal</);
  assert.match(html, /id="route-badge" class="route-badge">Kombirute</);
  assert.match(html, /id="day-label" class="day-label">Lastar/);
  const none = renderToString(createElement(App, { initialState: { routeChoice: "1136", lang: "nn" }, memory: memoryOnly() }));
  assert.match(none, /<header class="site-header is-pending-route">/);
});

test("fotnoten: «ingen kontakt med Entur» når sanntida feila, som vanilla (nn, en, de)", () => {
  const expected = {
    nn: /Fekk ikkje kontakt med Entur/,
    en: /Could not reach Entur/,
    de: /Keine Verbindung zu Entur/,
  };
  for (const [lang, pattern] of Object.entries(expected)) {
    const failed = render({ lang, initialEntur: { liveFailed: true } });
    assert.match(failed.match(/<span id="position-note">[^<]*/)[0], pattern, lang);
    const planned = render({ lang });
    assert.doesNotMatch(planned.match(/<span id="position-note">[^<]*/)[0], pattern, lang);
  }
});
