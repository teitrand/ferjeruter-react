// Fargetema: oppløysing (Enhet/Lys/Mørk), lagring, skriptet før fyrste teikning (ingen blink), meta theme-color,
// knappane (aria-pressed, nn/en/de) og at CSS og meta/manifest brukar same farge.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";
import { themeEarly, themeScript } from "../build/theme-early.js";
import { THEME_COLORS, THEME_KEY, applyTheme, normalizePref, readThemePref, resolveTheme, writeThemePref } from "../src/model/theme.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const repo = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, repo), "utf8");
const ROUTES = JSON.parse(read("tests/fixtures/ruter.json"));
const text = (html) => html.replace(/<wbr\/>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

let server;
let App;
let ThemeSwitch;
let memoryOnly;
let setLang;

before(async () => {
  server = await createServer({
    root,
    configFile: fileURLToPath(new URL("../vite.config.js", import.meta.url)),
    logLevel: "error",
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  ({ App } = await server.ssrLoadModule("/src/App.jsx"));
  ({ ThemeSwitch } = await server.ssrLoadModule("/src/components/ThemeSwitch.jsx"));
  ({ memoryOnly } = await server.ssrLoadModule("/src/model/context.js"));
  ({ setLang } = await server.ssrLoadModule("/src/components/i18n.js"));
});

after(async () => {
  setLang("nn");
  await server?.close();
});

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => void (data[k] = String(v)),
    removeItem: (k) => void delete data[k],
    data,
  };
}

function fakeDoc() {
  const attrs = {};
  const meta = { "theme-color": { content: "#073b4c" }, "color-scheme": { content: "light dark" } };
  const el = (m) => ({ setAttribute: (k, v) => void (m[k] = v), getAttribute: (k) => m[k] });
  const root = { ...el(attrs), style: {} };
  return {
    attrs,
    meta,
    documentElement: root,
    querySelector: (sel) => {
      const name = sel.match(/name="([^"]+)"/)?.[1];
      const m = meta[name];
      return m ? { setAttribute: (k, v) => void (m[k] = v) } : null;
    },
  };
}

test("resolveTheme: Enhet følgjer eininga, Lys/Mørk vinn alltid", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme(undefined, true), "dark", "ukjent val = Enhet");
  assert.equal(resolveTheme("blå", false), "light");
  assert.equal(normalizePref(null), "system");
  assert.equal(normalizePref("dark"), "dark");
});

test("lagring: Enhet er standard og lagrar ingenting; Lys/Mørk blir hugsa; ugyldig verdi blir Enhet", () => {
  const storage = memoryStorage();
  assert.equal(readThemePref(storage), "system");
  writeThemePref("dark", storage);
  assert.equal(storage.data[THEME_KEY], "dark");
  assert.equal(readThemePref(storage), "dark");
  writeThemePref("light", storage);
  assert.equal(readThemePref(storage), "light");
  writeThemePref("system", storage);
  assert.ok(!(THEME_KEY in storage.data), "Enhet fjernar nøkkelen");
  assert.equal(readThemePref(memoryStorage({ [THEME_KEY]: "rosa" })), "system");
  const broken = { getItem() { throw new Error("blokkert"); }, setItem() { throw new Error("blokkert"); }, removeItem() { throw new Error("blokkert"); } };
  assert.equal(readThemePref(broken), "system");
  assert.doesNotThrow(() => writeThemePref("dark", broken));
});

test("applyTheme: data-theme, color-scheme og begge meta-taggane", () => {
  const doc = fakeDoc();
  assert.equal(applyTheme(doc, "system", true), "dark");
  assert.equal(doc.attrs["data-theme"], "dark");
  assert.equal(doc.attrs["data-theme-pref"], "system");
  assert.equal(doc.documentElement.style.colorScheme, "dark");
  assert.equal(doc.meta["theme-color"].content, THEME_COLORS.dark);
  assert.equal(doc.meta["color-scheme"].content, "light dark", "Enhet: la nettlesaren velje");
  assert.equal(applyTheme(doc, "light", true), "light");
  assert.equal(doc.meta["theme-color"].content, THEME_COLORS.light);
  assert.equal(doc.meta["color-scheme"].content, "light", "tvinga: låst");
  assert.equal(applyTheme(doc, "dark", false), "dark");
  assert.equal(doc.meta["theme-color"].content, THEME_COLORS.dark);
  assert.doesNotThrow(() => applyTheme({ documentElement: doc.documentElement, querySelector: () => null }, "dark", false), "manglar meta");
});

function runEarly({ stored, systemDark, matchMedia = true, brokenStorage = false }) {
  const doc = fakeDoc();
  const storage = brokenStorage ? { getItem() { throw new Error("nei"); } } : memoryStorage(stored === undefined ? {} : { [THEME_KEY]: stored });
  const win = matchMedia ? { matchMedia: (q) => ({ matches: q.includes("dark") && systemDark }) } : {};
  const ctx = vm.createContext({ document: doc, window: win, localStorage: storage });
  vm.runInContext(themeScript(), ctx);
  return doc;
}

test("skriptet før fyrste teikning gjev same svar som modellen i alle kombinasjonar", () => {
  for (const stored of [undefined, "light", "dark", "system", "rosa"]) {
    for (const systemDark of [false, true]) {
      const doc = runEarly({ stored, systemDark });
      const pref = normalizePref(stored);
      const model = fakeDoc();
      const theme = applyTheme(model, pref, systemDark);
      const label = `${stored}/${systemDark}`;
      assert.equal(doc.attrs["data-theme"], theme, label);
      assert.equal(doc.attrs["data-theme-pref"], pref, label);
      assert.equal(doc.documentElement.style.colorScheme, theme, label);
      assert.equal(doc.meta["theme-color"].content, model.meta["theme-color"].content, label);
      assert.equal(doc.meta["color-scheme"].content, model.meta["color-scheme"].content, label);
    }
  }
});

test("skriptet tåler blokkert lagring og manglande matchMedia (då lyst), og kastar aldri", () => {
  assert.equal(runEarly({ brokenStorage: true, systemDark: true }).attrs["data-theme"], "dark", "lagring blokkert: følg eininga");
  assert.equal(runEarly({ stored: "dark", matchMedia: false }).attrs["data-theme"], "dark");
  assert.equal(runEarly({ matchMedia: false }).attrs["data-theme"], "light");
});

test("byggjesteget set skriptet inn i <head> (etter meta-taggane, før teikning); index.html har begge meta-taggane", () => {
  const tags = themeEarly().transformIndexHtml();
  assert.equal(tags.length, 1);
  assert.equal(tags[0].tag, "script");
  assert.equal(tags[0].injectTo, "head", "etter meta theme-color, så skriptet finn han");
  assert.equal(tags[0].children, themeScript());
  assert.ok(!/<script[^>]*\b(async|defer|type="module")/.test(tags[0].tag), "synkront skript");
  const html = read("web/index.html");
  assert.match(html, /<meta name="theme-color" content="#073b4c">/);
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
});

test("fargane stemmer: meta/manifest = lyst, mørk theme-color = sidebakgrunnen i det mørke temaet", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert.equal(THEME_COLORS.light, manifest.theme_color);
  assert.equal(THEME_COLORS.light, read("web/index.html").match(/name="theme-color" content="([^"]+)"/)[1]);
  const dark = read("web/src/styles/theme.css").match(/html\[data-theme="dark"\]\s*\{[\s\S]*?--page:\s*(#[0-9a-f]{6})/i)[1];
  assert.equal(THEME_COLORS.dark.toLowerCase(), dark.toLowerCase());
  const lightPage = read("assets/styles.css").match(/--fjord:\s*(#[0-9a-f]{6})/i)[1];
  assert.equal(THEME_COLORS.light.toLowerCase(), lightPage.toLowerCase());
});

test("CSS: color-scheme følgjer temaet (skjemafelt, rullefelt), og main.jsx lastar mørkt tema", () => {
  assert.match(read("assets/styles.css"), /:root \{\s*color-scheme: light;/);
  assert.match(read("web/src/styles/theme.css"), /html\[data-theme="dark"\] \{\s*color-scheme: dark;/);
  assert.match(read("web/src/main.jsx"), /import "\.\/styles\/theme\.css";/);
});

test("knappane: merkt gruppe, tre knappar med aria-pressed og synleg tekst (nn/en/de)", () => {
  const labels = { nn: ["Utsjånad", "Enhet", "Lys", "Mørk"], en: ["Appearance", "Device", "Light", "Dark"], de: ["Darstellung", "Gerät", "Hell", "Dunkel"] };
  for (const [lang, [group, system, light, dark]] of Object.entries(labels)) {
    setLang(lang);
    for (const [pref, pressed] of [["system", [true, false, false]], ["light", [false, true, false]], ["dark", [false, false, true]]]) {
      const html = renderToString(createElement(ThemeSwitch, { pref, theme: "dark", onChange() {} }));
      assert.match(html, new RegExp(`role="group" aria-label="${group}"`), lang);
      const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
      assert.equal(buttons.length, 3);
      assert.deepEqual(buttons.map((b) => /aria-pressed="true"/.test(b)), pressed, `${lang}/${pref}`);
      assert.ok(buttons.every((b) => /type="button"/.test(b) && /aria-pressed=/.test(b)));
      assert.equal(text(html).trim(), `${system} ${light} ${dark}`, lang);
    }
  }
  setLang("nn");
  const html = renderToString(createElement(ThemeSwitch, { pref: "system", theme: "dark", onChange() {} }));
  assert.match(html, /title="Følg eininga \(no: Mørk\)"/, "Enhet viser kva eininga vil ha no");
});

test("appen: temavalet står i toppen, ved sida av språkvalet, éin gong", () => {
  const initialData = { routes: ROUTES, kombirute: null, messages: null, signalLog: null, connections: null };
  const initialState = { routeChoice: "1136", lang: "nn", override: null, date: null, showPast: true };
  const html = renderToString(createElement(App, { initialData, initialState, memory: memoryOnly() })).replace(/<!-- -->/g, "");
  assert.equal((html.match(/class="theme-switch"/g) || []).length, 1);
  const tools = html.slice(html.indexOf('class="header-tools"'), html.indexOf("</header>"));
  assert.ok(tools.indexOf("lang-switch") < tools.indexOf("theme-switch"), "språk først, så tema");
  assert.match(tools, /data-theme-pref="system" aria-pressed="true"/, "Enhet er valt som standard");
});
