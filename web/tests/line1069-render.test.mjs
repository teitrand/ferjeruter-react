// Samband 1069 Festøya–Solavågen (Norled/FRAM) i skalet: tittel, rader, ingen korrespondanse, fotnote, språk, AIS-grensa.
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

function render({ lang = "nn", routeChoice = "1069", routes = ROUTES, messages = null, override = null } = {}) {
  const initialData = { routes, kombirute: null, messages, signalLog: null, connections: CONNECTIONS };
  const initialState = { routeChoice, lang, override, date: null, showPast: true };
  return renderToString(createElement(App, { initialData, initialEntur: null, initialState, memory: memoryOnly() })).replace(/<!-- -->/g, "");
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
  assert.match(plain, /Neste avgang 10:30 frå Solavågen/, "statuslinja: berre neste avgang, ingen «ferja er …»");
  assert.doesNotMatch(plain, /Ferja er |Ferja ligg|Ferja er på veg|Overfart ca\./, "ingen eiga-ferje-status");
  assert.doesNotMatch(html, /class="timeline-now"|class="na[ "]/, "ingen «No»-kort eller -punkt");
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
