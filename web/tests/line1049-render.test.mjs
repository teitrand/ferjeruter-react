// Samband 1049 Festøya–Hundeidvik i skalet: tredje fane, tittel, rader, ingen korrespondanse, fotnote, språk.
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
// Måndag 12. oktober 2026 kl. 10:20 i Oslo (UTC+2): ferja ligg ved Hundeidvik til 11:00.
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

function render({ lang = "nn", routeChoice = "1049", routes = ROUTES, messages = null, override = null } = {}) {
  const initialData = { routes, kombirute: null, messages, signalLog: null, connections: CONNECTIONS };
  const initialState = { routeChoice, lang, override, date: null, showPast: true };
  return renderToString(createElement(App, { initialData, initialEntur: null, initialState, memory: memoryOnly() })).replace(/<!-- -->/g, "");
}

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("1049: tittel, overtittel, tre faner med 1049 vald, ?rute=1049", () => {
  const html = render();
  assert.match(html, /id="route-title">Festøya–Hundeidvik</);
  assert.match(html, /class="eyebrow">Rute 1049 · Fjord1 \/ FRAM</);
  const chips = [...html.matchAll(/<button type="button" class="(chip(?: is-active)?)" aria-pressed="(true|false)">([^<]+)<\/button>/g)].filter((m) => /–/.test(m[3]) && /Standal|Sæbø|Festøya/.test(m[3]));
  assert.deepEqual(chips.map((m) => m[3]), ["Standal–Trandal", "Sæbø–Leknes", "Festøya–Hundeidvik"]);
  assert.deepEqual(chips.map((m) => m[2]), ["false", "false", "true"]);
  const viaOverride = render({ routeChoice: "1136", override: "1049" });
  assert.match(viaOverride, /id="route-title">Festøya–Hundeidvik</);
});

test("1049: avgangar Festøya↔Hundeidvik, ingen Hjørundfjord-rader, ankomsttider på, ingen korrespondanse", () => {
  const html = render();
  const plain = text(html);
  assert.match(plain, /11:00\s+Hundeidvik → Festøya/);
  assert.match(plain, /11:30\s+Festøya → Hundeidvik/);
  assert.match(plain, /Ankomst 11:25/);
  assert.match(html, /aria-pressed="true">Ankomsttider</, "ankomsttider er på");
  const body = plain.replace(/Vel samband Standal–Trandal Sæbø–Leknes Festøya–Hundeidvik/, "");
  assert.doesNotMatch(body, /Ferja flyttar seg|Standal|Trandal|Kvernes|Geiranger|Sæbø|På signal|Ring innan|signal/i, "ingen Hjørundfjord-tekst eller signalturar");
  assert.doesNotMatch(html, /id="conn-filter"[^>]*>\s*<label/, "korrespondanse-vala er skjult");
  assert.doesNotMatch(html, /class="conn-select/);
  // Frå/til-filteret har berre dei to kaiene.
  assert.match(html, /<option value="Festøya">Festøya<\/option>/);
  assert.match(html, /<option value="Hundeidvik">Hundeidvik<\/option>/);
  assert.doesNotMatch(html, /<option value="(Standal|Trandal|Sæbø)">/);
});

test("1049: meldingar om kombirute for 1136/1135 flyttar ikkje 1049", () => {
  const messages = {
    messages: [
      { id: "k", heading: "Kombinasjonsrute", text: "Kombinert rute 1135 og 1136 frå klokka 10:00", publishedAt: "2026-10-12T05:00:00Z", validFrom: "2026-10-12T05:00:00Z", isLocal: true, isRouteControl: true, routeMode: "kombi", routeSwitch: null, severity: "info" },
    ],
  };
  const html = render({ messages });
  assert.match(html, /id="route-title">Festøya–Hundeidvik</);
  assert.doesNotMatch(html, /id="route-badge"/);
  assert.match(text(html), /11:00\s+Hundeidvik → Festøya/);
});

test("1049: fotnote og botn utan Kvernes-telefon (ferjetelefonen er ikkje kjend)", () => {
  const html = render();
  assert.match(html, /<a id="footnote-nais"[^>]*>M\/F Dryna på NAIS</);
  assert.match(html, /href="https:\/\/www\.fjord1\.no\/ruteoversikt\/moere-og-romsdal\/festoeya-hundeidvika\/\(page\)\/pdf"/);
  const footer = html.slice(html.indexOf('id="footer-operator"'), html.indexOf("</p>", html.indexOf('id="footer-operator"')));
  assert.match(text(footer), /Operatør Fjord1\. Ruteeigar FRAM\. M\/F Dryna\./);
  assert.doesNotMatch(footer, /916 69|Kvernes|tlf/);
});

test("1049: engelsk og tysk (tittel, overtittel, fane)", () => {
  const en = render({ lang: "en" });
  assert.match(en, /class="eyebrow">Route 1049 · Fjord1 \/ FRAM</);
  assert.match(en, /id="route-title">Festøya–Hundeidvik</);
  assert.match(text(en), /Operator Fjord1\. Route owner FRAM\. M\/F Dryna\./);
  const de = render({ lang: "de" });
  assert.match(de, /class="eyebrow">Linie 1049 · Fjord1 \/ FRAM</);
  assert.match(text(de), /Betreiber Fjord1\. Auftraggeber FRAM\. M\/F Dryna\./);
  assert.match(de, /aria-pressed="true">Festøya–Hundeidvik</);
});

test("1049 utan data i rutetabellen: ingen tom fane, valet fell tilbake til 1136", () => {
  const without = { ...ROUTES, lines: { 1136: ROUTES.lines["1136"], 1135: ROUTES.lines["1135"] } };
  const html = render({ routes: without });
  assert.doesNotMatch(html, /Festøya–Hundeidvik<\/button>/);
  assert.match(html, /id="route-title">Standal–Trandal–Sæbø/);
  assert.match(html, /class="chip is-active" aria-pressed="true">Standal–Trandal</);
});
