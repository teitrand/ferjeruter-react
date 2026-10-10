// Samband-veljaren: modell (éi liste, Neste hh:mm, piltastar), a11y-markup i kortet og arket, ?samband=,
// CSS (padding-bottom, redusert rørsle) og at «No»-raden ikkje blir dekt av det faste kortet.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";
import { CHOOSABLE_ROUTES, ROUTE_CATALOG, routeFromQuery, routeHasData } from "../../packages/core/index.js";
import { nextRadioIndex, routePicker } from "../src/model/routes.js";
import { syncRouteQuery } from "../src/model/storage.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const repo = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, repo), "utf8");
const ROUTES = JSON.parse(read("tests/fixtures/ruter.json"));
const CSS = read("web/src/styles/picker.css");
// Måndag 12. oktober 2026 kl. 10:20 i Oslo (UTC+2).
const FIXED = Date.UTC(2026, 9, 12, 8, 20);
const RealDate = Date;
const text = (html) => html.replace(/<wbr\/>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

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

function render({ lang = "nn", routeChoice = "1136", routes = ROUTES } = {}) {
  const initialData = { routes, kombirute: null, messages: null, signalLog: null, connections: null };
  const initialState = { routeChoice, lang, override: null, date: null, showPast: true };
  return renderToString(createElement(App, { initialData, initialState, memory: memoryOnly() })).replace(/<!-- -->/g, "");
}

const sheet = (html) => html.slice(html.indexOf('<dialog'), html.indexOf("</dialog>"));
const card = (html) => html.slice(html.indexOf('<div class="route-bar"'), html.indexOf("</div>", html.indexOf('<div class="route-bar"')));

test("katalogen er den einaste lista: valbare samband og plassholdar", () => {
  assert.deepEqual(ROUTE_CATALOG.map((route) => route.id), ["1136", "1135", "1049", "1069"]);
  assert.deepEqual([...CHOOSABLE_ROUTES], ["1136", "1135", "1049"]);
  assert.equal(routeHasData("1069", { routes: ROUTES }), false, "1069 er berre ei rad");
  assert.equal(routeHasData("1049", { routes: ROUTES }), true);
  assert.equal(routeHasData("1049", { routes: { lines: { 1136: {}, 1135: {} } } }), false, "1049 utan data");
  assert.equal(routeHasData("1049", { routes: null }), true, "medan tabellen lastar");
});

test("routePicker: valt, valbare og «Kjem snart»; Neste hh:mm frå tabellen", () => {
  const picker = routePicker({ routes: ROUTES }, { routeChoice: "1135" }, 10 * 60 + 20, "2026-10-12");
  assert.equal(picker.selected, "1135");
  assert.deepEqual(picker.items.map((item) => [item.id, item.state]), [["1136", "available"], ["1135", "selected"], ["1049", "available"], ["1069", "soon"]]);
  for (const item of picker.items.filter((entry) => entry.state !== "soon")) assert.match(item.next.time, /^\d\d:\d\d$/, item.id);
  assert.equal(picker.items[3].next, null);
  // Måndag 10:20: første avgang etter det er 10:30 for 1049 og 13:10 for 1136 (tabellen i fixtures).
  assert.deepEqual(picker.items[2].next, { when: "today", time: "10:30" });
  assert.deepEqual(picker.items[0].next, { when: "today", time: "13:10" });
  const without = routePicker({ routes: { ...ROUTES, lines: { 1136: ROUTES.lines["1136"], 1135: ROUTES.lines["1135"] } } }, { routeChoice: "1049" }, 600, "2026-10-12");
  assert.equal(without.selected, "1136", "1049 utan data fell tilbake");
  assert.equal(without.items[2].state, "soon");
  const late = routePicker({ routes: ROUTES }, { routeChoice: "1136" }, 23 * 60 + 59, "2026-10-12");
  assert.equal(late.items[0].next.when, "tomorrow", "ingen fleire i dag: første i morgon");
});

test("piltastar hoppar over «Kjem snart» og rundar; Home/End", () => {
  const items = [{ state: "selected" }, { state: "available" }, { state: "soon" }, { state: "soon" }];
  assert.equal(nextRadioIndex(items, 0, "ArrowDown"), 1);
  assert.equal(nextRadioIndex(items, 1, "ArrowDown"), 0, "rundar forbi dei grå");
  assert.equal(nextRadioIndex(items, 0, "ArrowUp"), 1);
  assert.equal(nextRadioIndex(items, 0, "ArrowRight"), 1);
  assert.equal(nextRadioIndex(items, 1, "ArrowLeft"), 0);
  assert.equal(nextRadioIndex(items, 1, "Home"), 0);
  assert.equal(nextRadioIndex(items, 0, "End"), 1);
  assert.equal(nextRadioIndex(items, 0, "a"), null);
  assert.equal(nextRadioIndex([{ state: "soon" }], 0, "ArrowDown"), null);
});

test("kortet: éin knapp med aria-haspopup/expanded/controls, namn og «Byt samband»", () => {
  const html = render();
  const bar = card(html);
  assert.match(bar, /<button type="button" id="route-card" class="route-card" aria-haspopup="dialog" aria-expanded="false" aria-controls="route-sheet"/);
  assert.equal((bar.match(/<button/g) || []).length, 1, "ikkje nesta knappar");
  assert.match(text(bar), /^ *Valt samband Standal–Trandal Byt samband *$/);
  assert.match(bar, /Standal–<wbr\/>Trandal/, "brot berre etter tankestreken");
});

test("arket: dialog, aria-modal, tittel, radiogruppe, valt rad og «Lukk»", () => {
  const html = sheet(render());
  assert.match(html, /<dialog[^>]*id="route-sheet"[^>]*aria-modal="true"[^>]*aria-labelledby="route-sheet-title"/);
  assert.match(html, /<h2 id="route-sheet-title">Vel samband<\/h2>/);
  assert.match(html, /role="radiogroup" aria-labelledby="route-sheet-title"/);
  assert.match(html, />Lukk<\/button>/);
  assert.match(html, /Valet vert hugsa på denne eininga\./);
  const rows = [...html.matchAll(/<button type="button" role="radio"[^>]*>/g)].map((match) => match[0]);
  assert.equal(rows.length, 4);
  assert.match(rows[0], /aria-checked="true" tabindex="0"[^>]*data-route="1136"/);
  assert.match(rows[1], /aria-checked="false" tabindex="-1"[^>]*data-route="1135"/);
  assert.doesNotMatch(rows[1], /aria-disabled/);
  assert.match(text(html), /Standal–Trandal Linje 1136 · Neste \d\d:\d\d Sæbø–Leknes Linje 1135 · Neste \d\d:\d\d Festøya–Hundeidvik Linje 1049 · Neste 10:30 Festøya–Solavågen Linje 1069 · Kjem snart/);
});

test("«Kjem snart»: 1069 alltid; 1049 til tabellen har linja; aria-disabled og namnet inneheld teksten", () => {
  const html = sheet(render({ routes: { ...ROUTES, lines: { 1136: ROUTES.lines["1136"], 1135: ROUTES.lines["1135"] } } }));
  const soon = [...html.matchAll(/<button type="button" role="radio" class="route-row is-soon"[^>]*>(.*?)<\/button>/g)];
  assert.deepEqual(soon.map((match) => /data-route="(\d+)"/.exec(match[0])[1]), ["1049", "1069"]);
  for (const match of soon) {
    assert.match(match[0], /aria-disabled="true"/);
    assert.match(match[0], /aria-checked="false"/);
    assert.match(text(match[1]), /Kjem snart/);
  }
});

test("engelsk og tysk: kort, ark, radar", () => {
  const en = render({ lang: "en", routeChoice: "1135" });
  assert.match(text(card(en)), /Selected route Sæbø–Leknes Change route/);
  assert.match(text(sheet(en)), /Choose route Close .*Route 1136 · Next \d\d:\d\d.*Route 1049 · Next 10:30.*Route 1069 · Coming soon Your choice is remembered on this device\./);
  const de = render({ lang: "de" });
  assert.match(text(card(de)), /Gewählte Verbindung Standal–Trandal Verbindung wechseln/);
  assert.match(text(sheet(de)), /Verbindung wählen Schließen .*Linie 1069 · Kommt bald/);
});

test("kortet ligg etter innhaldet og «No»-kortet ligg i innhaldet, ikkje i det faste kortet", () => {
  const html = render();
  const bar = html.indexOf('class="route-bar"');
  assert.ok(bar > html.indexOf('id="innhald"') && bar > html.indexOf('class="site-footer'), "kortet kjem etter main og botn");
  assert.ok(html.indexOf('class="na ') > 0 && html.indexOf('class="na ') < bar, "«No»-kortet er i main");
  assert.doesNotMatch(card(html), /class="na /);
});

test("CSS: innhaldet får padding-bottom = kortet, rullar fri; ark utan glid ved redusert rørsle; 16–17 px namn", () => {
  assert.match(CSS, /body \{ padding-bottom: var\(--route-bar-h\)/);
  assert.match(CSS, /scroll-padding-bottom: var\(--route-bar-h\)/);
  assert.match(CSS, /\.route-bar \{[^}]*position: fixed;[^}]*bottom: 0;/s);
  assert.match(CSS, /safe-area-inset-bottom/);
  const anim = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: no-preference)"));
  assert.match(anim, /\.route-sheet\[open\] \{ animation/);
  assert.doesNotMatch(CSS.slice(0, CSS.indexOf("@media (prefers-reduced-motion")), /animation|transition/, "ingen rørsle utanfor no-preference");
  assert.match(CSS, /\.route-card-name \{[^}]*font-size: 1\.0625rem/);
  assert.match(CSS, /\.route-row-name \{[^}]*font-size: 1rem/);
  assert.match(CSS, /\.route-row \{[^}]*min-height: 3\.5rem/s);
  assert.match(CSS, /\.route-card-action \{[^}]*min-height: 3rem/s);
});

test("?samband= gjev valbare samband, elles null; adresselinja følgjer valet berre når parameteren er der", () => {
  const url = (query) => ({ href: `https://teitrand.github.io/ferjeruter-react/${query}` });
  assert.equal(routeFromQuery(url("?samband=1049")), "1049");
  assert.equal(routeFromQuery(url("?samband=1135&x=1")), "1135");
  assert.equal(routeFromQuery(url("?samband=1069")), null, "plassholdar");
  assert.equal(routeFromQuery(url("?samband=kombi")), null);
  assert.equal(routeFromQuery(url("")), null);
  assert.equal(routeFromQuery(url("?rute=1049")), null, "?rute= er eit anna, uendra val");
  const calls = [];
  const hist = { state: null, replaceState: (...args) => calls.push(args) };
  syncRouteQuery("1135", url("?samband=1136&a=b"), hist);
  assert.equal(String(calls[0][2]), "https://teitrand.github.io/ferjeruter-react/?samband=1135&a=b");
  syncRouteQuery("1135", url(""), hist);
  assert.equal(calls.length, 1, "ingen ?samband= i adresselinja: ingen endring");
});
