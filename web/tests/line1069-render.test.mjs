// Samband 1069 Festøya–Solavågen (Norled/FRAM) i skalet: tittel, rader, ingen korrespondanse, fotnote, språk, AIS-grensa.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";
import { QUAY_COORDS, fixFromAis } from "../../packages/core/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const repo = new URL("../../", import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, repo), "utf8"));
const ROUTES = json("tests/fixtures/ruter.json");
const CONNECTIONS = json("data/korrespondanse.json");
// Måndag 12. oktober 2026 kl. 10:20 i Oslo (UTC+2): to ferjer går om kvarandre.
const FIXED = Date.UTC(2026, 9, 12, 8, 20);
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

function render({ lang = "nn", routeChoice = "1069", routes = ROUTES, messages = null, override = null, initialSanntid = null } = {}) {
  const initialData = { routes, kombirute: null, messages, signalLog: null, connections: CONNECTIONS };
  const initialState = { routeChoice, lang, override, date: null, showPast: true };
  return renderToString(createElement(App, { initialData, initialEntur: null, initialSanntid, initialState, memory: memoryOnly() })).replace(/<!-- -->/g, "");
}

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("1069: tittel, overtittel, kortet viser 1069 som valt, ?rute=1069", () => {
  const html = render();
  assert.match(html, /id="route-title">Festøya–Solavågen</);
  assert.match(html, /class="eyebrow">Rute 1069 · Norled \/ FRAM</);
  assert.match(text(html.slice(html.indexOf('id="route-card"'), html.indexOf("</button>", html.indexOf('id="route-card"')))), /Valt samband Festøya– ?Solavågen Byt samband/);
  assert.match(html, /role="radio" class="route-row is-selected" aria-checked="true"[^>]*data-route="1069"/);
  assert.doesNotMatch(html, /role="radio" class="route-row is-soon"/, "ingen «Kjem snart» når alle samband har data");
  assert.match(render({ routeChoice: "1136", override: "1069" }), /id="route-title">Festøya–Solavågen</);
});

test("1069: avgangar Festøya↔Solavågen, ingen Hjørundfjord-rader, ingen signalturar, ingen korrespondanse", () => {
  const html = render();
  const plain = text(html);
  assert.match(plain, /10:40\s+Festøya → Solavågen/);
  assert.match(plain, /10:30\s+Solavågen → Festøya/);
  assert.match(plain, /Neste avgang 10:30 frå Solavågen/, "statuslinja: neste avgang");
  assert.doesNotMatch(plain, /Ferja er |Ferja ligg|Overfart ca\./, "ingen eiga-ferje-status: «ei ferje», ikkje «ferja»");
  assert.doesNotMatch(html, /Liggetid|Tomtur/i);
  assert.match(plain, /Ankomst 11:00/);
  const body = text(html.slice(html.indexOf('id="timetable-panel"'), html.indexOf('id="route-card"')));
  assert.doesNotMatch(body, /Ferja flyttar seg|Standal|Trandal|Kvernes|Geiranger|Sæbø|På signal|Ring innan|signal/i);
  assert.doesNotMatch(html, /class="conn-select/);
  assert.match(html, /<option value="Festøya">Festøya<\/option>/);
  assert.match(html, /<option value="Solavågen">Solavågen<\/option>/);
  assert.doesNotMatch(html, /<option value="(Standal|Trandal|Sæbø|Hundeidvik)">/);
});

test("1069: meldingar om kombirute for 1136/1135 flyttar ikkje 1069", () => {
  const messages = { messages: [{ id: "k", heading: "Kombinasjonsrute", text: "Kombinert rute 1135 og 1136 frå klokka 10:00", publishedAt: "2026-10-12T05:00:00Z", validFrom: "2026-10-12T05:00:00Z", isLocal: true, isRouteControl: true, routeMode: "kombi", routeSwitch: null, severity: "info" }] };
  const html = render({ messages });
  assert.match(html, /id="route-title">Festøya–Solavågen</);
  assert.doesNotMatch(html, /id="route-badge"/);
});

test("1069: fotnote og botn utan ferjetelefon og utan éi namngjeven ferje (tre ferjer)", () => {
  const html = render();
  assert.match(html, /href="https:\/\/frammr\.no\/[^"]*1069-festoya-solavagen[^"]*\.pdf"/);
  assert.match(html, /<a id="footnote-nais"[^>]*>Ferjene på NAIS</);
  assert.doesNotMatch(html, /M\/F Dryna|M\/F Kvernes/);
  const footer = html.slice(html.indexOf('id="footer-operator"'), html.indexOf("</p>", html.indexOf('id="footer-operator"')));
  assert.match(text(footer), /Operatør Norled\. Ruteeigar FRAM\./);
  assert.doesNotMatch(footer, /916|Kvernes|tlf/);
});

test("1069: engelsk og tysk (tittel, overtittel, botn)", () => {
  const en = render({ lang: "en" });
  assert.match(en, /class="eyebrow">Route 1069 · Norled \/ FRAM</);
  assert.match(en, /id="route-title">Festøya–Solavågen</);
  assert.match(text(en), /Operator Norled\. Route owner FRAM\./);
  const de = render({ lang: "de" });
  assert.match(de, /class="eyebrow">Linie 1069 · Norled \/ FRAM</);
  assert.match(text(de), /Betreiber Norled\. Auftraggeber FRAM\./);
});

test("1069 utan data i rutetabellen: «Kjem snart» i arket, valet fell tilbake til 1136", () => {
  const without = { ...ROUTES, lines: { 1136: ROUTES.lines["1136"], 1135: ROUTES.lines["1135"], 1049: ROUTES.lines["1049"] } };
  const html = render({ routes: without });
  assert.match(html, /role="radio" class="route-row is-soon" aria-checked="false" aria-disabled="true" tabindex="-1" data-route="1069"/);
  assert.match(html, /id="route-title">Standal–Trandal–Sæbø/);
});

test("1069: meldingspanelet viser 1069-meldinga, og ho flyttar ikkje sambandet", () => {
  const messages = {
    fetchedAt: "2026-10-12T05:30:00Z",
    messages: [
      { id: "m1069", heading: "Festøya – Solavågen", text: "Rute 1069: ei ferje er ute av drift, avgangar kan bli innstilt.", publishedAt: "2026-10-12T05:00:00Z", validFrom: "2026-10-12T05:00:00Z", validTo: "2026-10-12T13:00:00Z", severity: "cancelled", isLocal: true, isRouteControl: false, isRoute1136: false, routeMode: null, routeSwitch: null },
    ],
  };
  const html = render({ messages });
  assert.match(text(html), /Festøya – Solavågen/);
  assert.match(text(html), /ei ferje er ute av drift/);
  assert.match(html, /id="route-title">Festøya–Solavågen</);
});

// --- «No»-kortet med fleire ferjer: AIS per fartøy (aisAll), ferje vald per tur ---

const nowArea = (html) => html.match(/<section class="na [^>]*>.*?<\/section>/s)?.[0] || "";
const F = QUAY_COORDS.Festøya;
const S = QUAY_COORDS.Solavågen;
const bearing = (a, b) => {
  const rad = (deg) => (deg * Math.PI) / 180;
  const y = Math.sin(rad(b.longitude - a.longitude)) * Math.cos(rad(b.latitude));
  const x = Math.cos(rad(a.latitude)) * Math.sin(rad(b.latitude)) - Math.sin(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(rad(b.longitude - a.longitude));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};
/** AIS-posisjon `f` (0..1) frå `a` mot `b`, kurs mot `b`, `ageMs` gammal. */
const ais = (mmsi, a, b, f, { ageMs = 8000, sog = 9 } = {}) => ({
  line: "1069",
  fix: fixFromAis({
    mmsi,
    latitude: a.latitude + (b.latitude - a.latitude) * f,
    longitude: a.longitude + (b.longitude - a.longitude) * f,
    sog,
    cog: sog > 0 ? bearing(a, b) : null,
    navStatus: 0,
    timestamp: FIXED - ageMs,
  }),
});
const TIDEFJORD = 258220500;
const FESTOYA = 257090560;
const SOLAVAGEN = 257090550;

test("1069 «No»-kort utan AIS: «Ei ferje … Truleg på veg», berekna frå rutetabellen, aldri «Ferja»", () => {
  const html = render();
  const card = text(nowArea(html));
  assert.match(card, /Truleg på veg mot (Festøya|Solavågen)/);
  assert.match(card, /Berekna frå rutetabellen/);
  assert.doesNotMatch(card, /Utanfor ruta|Ferja er |Ferja ligg/);
  assert.match(text(html.match(/id="lede-status">.*?<\/p>/s)[0]), /Ei ferje er på veg mot (Festøya|Solavågen)\. Neste avgang/);
  assert.match(html, /<div class="timeline-now"><section class="na /, "kortet står som punkt på tidslinja, ved turen som går");
});

test("1069 «No»-kort med AIS: ferja som går mot Solavågen vert vald per tur (kurs), med fart og «Live frå AIS»", () => {
  // Solavågen→Festøya (10:10) står først i lista, men det er ferja mot Solavågen vi har måling for.
  const html = render({ initialSanntid: { entries: [ais(SOLAVAGEN, F, S, 0.5), ais(TIDEFJORD, F, F, 0, { sog: 0 })] } });
  const card = text(nowArea(html));
  assert.match(card, /På veg mot Solavågen/);
  assert.match(card, /9 knop/);
  assert.match(card, /Live frå AIS · 8 s/);
  assert.doesNotMatch(card, /Berekna frå rutetabellen|Utanfor ruta/);
  assert.match(text(html.match(/id="lede-status">.*?<\/p>/s)[0]), /Ei ferje er på veg mot Solavågen/);
});

test("1069 «No»-kort: ferja mot Festøya vert vald når berre ho er målt, og ei tredje ferje langt unna gjer ikkje «Utanfor ruta»", () => {
  const far = { latitude: 62.55, longitude: 6.1 };
  const html = render({
    initialSanntid: { entries: [ais(FESTOYA, S, F, 0.4, { sog: 8 }), { line: "1069", fix: fixFromAis({ mmsi: TIDEFJORD, ...far, sog: 0, cog: null, navStatus: 5, timestamp: FIXED - 5000 }) }] },
  });
  const card = text(nowArea(html));
  assert.match(card, /På veg mot Festøya/);
  assert.match(card, /8 knop/);
  assert.doesNotMatch(card, /Utanfor ruta/);
  // Berre ei ferje langt unna og ingen på turen: berekna frå rutetabellen, ikkje «utanfor ruta».
  const lone = render({ initialSanntid: { entries: [{ line: "1069", fix: fixFromAis({ mmsi: TIDEFJORD, ...far, sog: 0, cog: null, navStatus: 5, timestamp: FIXED - 5000 }) }] } });
  assert.doesNotMatch(text(nowArea(lone)), /Utanfor ruta/);
  assert.match(text(nowArea(lone)), /Truleg på veg/);
});

test("1069 «No»-kort: engelsk og tysk", () => {
  const entries = [ais(SOLAVAGEN, F, S, 0.5)];
  const en = text(nowArea(render({ lang: "en", initialSanntid: { entries } })));
  assert.match(en, /Heading to Solavågen/);
  assert.match(en, /9 knots/);
  assert.match(en, /Live from AIS · 8 s/);
  assert.match(text(render({ lang: "en", initialSanntid: { entries } }).match(/id="lede-status">.*?<\/p>/s)[0]), /A ferry is heading to Solavågen/);
  const de = text(nowArea(render({ lang: "de", initialSanntid: { entries } })));
  assert.match(de, /Unterwegs nach Solavågen/);
  assert.match(de, /9 Knoten/);
  assert.match(text(render({ lang: "de", initialSanntid: { entries } }).match(/id="lede-status">.*?<\/p>/s)[0]), /Eine Fähre ist unterwegs nach Solavågen/);
});
