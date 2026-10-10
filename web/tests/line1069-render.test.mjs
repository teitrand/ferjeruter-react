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
let FIXED = Date.UTC(2026, 9, 12, 8, 20);
const MONDAY_1020 = FIXED;
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
  assert.match(html, /class="eyebrow">Rute 1069 · Norled\/Fram</);
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
  assert.match(plain, /Neste avgang 10:30 frå Solavågen · om 10 min/, "statuslinja: neste avgang");
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
  assert.match(en, /class="eyebrow">Route 1069 · Norled\/Fram</);
  assert.match(en, /id="route-title">Festøya–Solavågen</);
  assert.match(text(en), /Operator Norled\. Route owner FRAM\./);
  const de = render({ lang: "de" });
  assert.match(de, /class="eyebrow">Linie 1069 · Norled\/Fram</);
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

// --- Ferjelista (ei tekstrad per ferje, ingen teikning): AIS per fartøy ---

const lede = (html) => text((html.match(/id="lede-status">(.*?)<\/p>/s)?.[1] || "").replace(/<span class="visually-hidden">.*?<\/span>/g, "")).replace(/ \./g, ".");
const ferryList = (html) => html.match(/<ul class="ferries-list"[^>]*>.*?<\/ul>/s)?.[0] || "";
const rowsOf = (html) => [...ferryList(html).matchAll(/<li class="ferry-row[^>]*>(.*?)<\/li>/gs)].map((m) => m[1]);
const sr = (row) => row.match(/<span class="visually-hidden">(.*?)<\/span>/s)?.[1] || "";
const visible = (row) => text(row.match(/<span class="ferry-body"[^>]*>(.*)<\/span>$/s)?.[1] || "").trim();
const F = QUAY_COORDS.Festøya;
const S = QUAY_COORDS.Solavågen;
const bearing = (a, b) => {
  const rad = (deg) => (deg * Math.PI) / 180;
  const y = Math.sin(rad(b.longitude - a.longitude)) * Math.cos(rad(b.latitude));
  const x = Math.cos(rad(a.latitude)) * Math.sin(rad(b.latitude)) - Math.sin(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(rad(b.longitude - a.longitude));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};
/** AIS-posisjon `f` (0..1) frå `a` mot `b`, kurs mot `b`, `ageMs` gammal. */
const ais = (mmsi, name, a, b, f, { ageMs = 8000, sog = 9 } = {}) => ({
  line: "1069",
  fix: fixFromAis({
    mmsi,
    name,
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
const THREE = () => [
  ais(SOLAVAGEN, "SOLAVAGEN", F, S, 0.5), // på veg mot Solavågen, neste avgang derifrå 10:30
  ais(FESTOYA, "FESTOYA", F, F, 0, { sog: 0, ageMs: 20000 }), // ligg ved Festøya, neste avgang derifrå 10:20
  ais(TIDEFJORD, "TIDEFJORD", F, F, 0, { sog: 0, ageMs: 20 * 60000 }), // ingen melding på 20 min
];

test("1069 ferjelista utan AIS: éi rad «Truleg på veg», berekna frå rutetabellen, ingen teikning eller «No»-kort", () => {
  const html = render();
  const rows = rowsOf(html);
  assert.equal(rows.length, 1);
  assert.match(visible(rows[0]), /Truleg på veg mot (Festøya|Solavågen)/);
  assert.match(visible(rows[0]), /Berekna frå rutetabellen/);
  assert.match(html, /<ul class="ferries-list" aria-label="Ferjer">/);
  assert.doesNotMatch(html, /<section class="na |class="timeline-now"|class="na-ferry|<svg class="na-/, "ingen ferjeteikning eller linje");
  assert.doesNotMatch(lede(html), /Ferja |Ei ferje/);
});

test("1069 ferjelista: éi rad per ferje, namn frå AIS, fart og kjeldemerke, ferja med neste avgang fyrst", () => {
  const html = render({ initialSanntid: { entries: THREE() } });
  const rows = rowsOf(html);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => visible(row).split(" · ")[0]), ["Festøya", "Solavågen", "Tidefjord"], "10:20 frå Festøya, 10:30 frå Solavågen, ukjend sist");
  assert.match(visible(rows[0]), /^Festøya · ligg til kai på Festøya Live frå AIS · 20 s$/);
  assert.match(visible(rows[1]), /^Solavågen · Festøya mot Solavågen · 9 knop Live frå AIS · 8 s$/);
  assert.match(visible(rows[2]), /^Tidefjord · Ukjent · ingen sanntid sidan 10:00 Siste kjende · 20 min sidan$/);
  assert.match(rows[2], /data-state="unknown"/);
  // Éi kort setning per rad til skjermlesar; synleg tekst er aria-hidden; ingen aria-live på radene.
  assert.equal(sr(rows[1]), "Solavågen: Festøya mot Solavågen, 9 knop. Målt med AIS for under eitt minutt sidan.");
  assert.equal(sr(rows[0]), "Festøya: ligg til kai på Festøya. Målt med AIS for under eitt minutt sidan.");
  assert.doesNotMatch(ferryList(html), /aria-live|role="status"/);
  assert.match(rows[1], /<span class="ferry-body" aria-hidden="true">/);
  assert.doesNotMatch(html, /<section class="na |class="timeline-now"/);
});

test("1069 ferjelista: ei ferje langt unna er «utanfor ruta», ikkje del av ein tur", () => {
  const far = { line: "1069", fix: fixFromAis({ mmsi: TIDEFJORD, name: "TIDEFJORD", latitude: 62.55, longitude: 6.1, sog: 0, cog: null, navStatus: 5, timestamp: FIXED - 5000 }) };
  const rows = rowsOf(render({ initialSanntid: { entries: [ais(FESTOYA, "FESTOYA", S, F, 0.4, { sog: 8 }), far] } }));
  assert.match(visible(rows[0]), /^Festøya · Solavågen mot Festøya · 8 knop/);
  assert.match(visible(rows[1]), /^Tidefjord · utanfor ruta/);
});

test("1069 ferjelista: engelsk og tysk", () => {
  const entries = THREE();
  const en = rowsOf(render({ lang: "en", initialSanntid: { entries } }));
  assert.match(visible(en[0]), /^Festøya · at the quay at Festøya Live from AIS · 20 s$/);
  assert.match(visible(en[1]), /^Solavågen · Festøya towards Solavågen · 9 knots Live from AIS · 8 s$/);
  assert.match(sr(en[1]), /^Solavågen: Festøya towards Solavågen, 9 knots\. Measured with AIS under one minute ago\.$/);
  assert.match(render({ lang: "en", initialSanntid: { entries } }), /<ul class="ferries-list" aria-label="Ferries">/);
  const de = rowsOf(render({ lang: "de", initialSanntid: { entries } }));
  assert.match(visible(de[0]), /^Festøya · liegt am Kai in Festøya /);
  assert.match(visible(de[1]), /^Solavågen · Festøya Richtung Solavågen · 9 Knoten /);
  assert.match(sr(de[1]), /Mit AIS gemessen vor unter einer Minute\.$/);
  assert.match(render({ lang: "de", initialSanntid: { entries } }), /aria-label="Fähren"/);
});

// --- 1069 går heile døgnet: aldri «ferdig for dagen» / «Første tur i morgon», lista held fram over midnatt ---

function atOslo(hour, minute, fn) {
  const before = FIXED;
  FIXED = Date.UTC(2026, 9, 10, hour - 2, minute); // laurdag 10. oktober 2026 (UTC+2)
  try {
    return fn();
  } finally {
    FIXED = before;
  }
}

test("1069 kl. 23:44: «Neste avgang 00:10 frå Festøya · om 26 min», aldri «Første tur i morgon», og lista held fram etter midnatt", () => {
  const html = atOslo(23, 44, () => render());
  const status = lede(html);
  assert.match(status, /^Neste avgang 00:10 frå Festøya · om 26 min\./);
  assert.doesNotMatch(status, /Første tur|ferdig for dagen|i morgon/i);
  assert.match(html, /<span class="visually-hidden">om 26 minutt<\/span>/);
  const plain = text(html.slice(html.indexOf('class="timeline"')));
  assert.match(plain, /søndag 11\. oktober/);
  assert.match(plain, /00:10\s+Festøya → Solavågen/);
  assert.match(plain, /00:40\s+Solavågen → Festøya/);
  assert.equal([...html.matchAll(/class="timeline-dayhead"/g)].length, 1);
  assert.equal([...html.matchAll(/class="stop stop-dep(?! is-past)/g)].length, 6, "dei seks første avgangane i morgon");
  assert.doesNotMatch(text(html), /Ingen turar/);
});

test("1069 kl. 23:55 og kl. 00:05: neste avgang er alltid med, òg over midnatt (engelsk og tysk)", () => {
  assert.match(lede(atOslo(23, 55, () => render())), /^Neste avgang 00:10 frå Festøya · om 15 min\./);
  assert.match(lede(atOslo(23, 55, () => render({ lang: "en" }))), /^Next departure 00:10 from Festøya · in 15 min\./);
  assert.match(lede(atOslo(23, 55, () => render({ lang: "de" }))), /^Nächste Abfahrt 00:10 von Festøya · in 15 Min\./);
  assert.match(lede(atOslo(0, 5, () => render())), /^Neste avgang 00:10 frå Festøya · om 5 min\./);
  // Ved kl. 20:00 er det nok avgangar att i dag: ingen skjøyting til i morgon.
  const early = atOslo(20, 0, () => render());
  assert.doesNotMatch(early, /class="timeline-dayhead"/);
});

test("andre samband enn 1069 held på «Første tur i morgon» om natta (dei sluttar om kvelden)", () => {
  const html = atOslo(23, 44, () => render({ routeChoice: "1136" }));
  assert.match(lede(html), /Første tur i morgon \d\d:\d\d frå Standal/);
  assert.doesNotMatch(html, /class="timeline-dayhead"/);
});
