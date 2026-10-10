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
let LangSwitch;
let nextThemePref;
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
  ({ ThemeSwitch, nextThemePref } = await server.ssrLoadModule("/src/components/ThemeSwitch.jsx"));
  ({ LangSwitch } = await server.ssrLoadModule("/src/components/LangSwitch.jsx"));
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

const themeBtn = (pref) => renderToString(createElement(ThemeSwitch, { pref, onChange() {} })).replace(/<!-- -->/g, "");

test("temaknappen: éin ikonknapp som bladar Enhet → Lys → Mørk → Enhet, namn med val og neste (nn/en/de)", () => {
  assert.equal(nextThemePref("system"), "light");
  assert.equal(nextThemePref("light"), "dark");
  assert.equal(nextThemePref("dark"), "system", "tilbake til «følg eininga»");
  const names = {
    nn: { system: "Tema: Enhet. Byt til Lys", light: "Tema: Lys. Byt til Mørk", dark: "Tema: Mørk. Byt til Enhet" },
    en: { system: "Theme: Device. Switch to Light", light: "Theme: Light. Switch to Dark", dark: "Theme: Dark. Switch to Device" },
    de: { system: "Design: Gerät. Wechseln zu Hell", light: "Design: Hell. Wechseln zu Dunkel", dark: "Design: Dunkel. Wechseln zu Gerät" },
  };
  for (const [lang, byPref] of Object.entries(names)) {
    setLang(lang);
    for (const [pref, label] of Object.entries(byPref)) {
      const html = themeBtn(pref);
      assert.equal((html.match(/<button/g) || []).length, 1);
      assert.match(html, new RegExp(`aria-label="${label}"`), `${lang}/${pref}`);
      assert.match(html, new RegExp(`data-theme-pref="${pref}"`));
      assert.equal(text(html).trim(), "", "berre ikon, ingen synleg tekst");
    }
  }
  setLang("nn");
});

test("språkflagg: tre knappar med flagg, namn og aria-pressed", () => {
  setLang("nn");
  const html = renderToString(createElement(LangSwitch, { lang: "en", onChange() {} })).replace(/<!-- -->/g, "");
  const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
  assert.equal(buttons.length, 3);
  assert.deepEqual(buttons.map((b) => /aria-pressed="true"/.test(b)), [false, true, false]);
  for (const name of ["Nynorsk", "English", "Deutsch"]) assert.match(html, new RegExp(`aria-label="${name}"`));
  assert.equal((html.match(/<svg/g) || []).length, 3, "eitt flagg per knapp");
});

test("appen: appikon og namn til venstre, flagg og temaknapp til høgre i same rad, ingen tannhjul eller stripe, 44 px", () => {
  const initialData = { routes: ROUTES, kombirute: null, messages: null, signalLog: null, connections: null };
  const initialState = { routeChoice: "1136", lang: "nn", override: null, date: null, showPast: true };
  const html = renderToString(createElement(App, { initialData, initialState, memory: memoryOnly() })).replace(/<!-- -->/g, "");
  const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  assert.equal((header.match(/class="lang-switch"/g) || []).length, 1);
  assert.equal((header.match(/class="theme-btn"/g) || []).length, 1);
  assert.ok(header.indexOf("lang-switch") < header.indexOf("theme-btn"), "flagg først, så tema");
  assert.doesNotMatch(html, /settings-btn|settings-dialog|gear-icon|class="skyline"|theme-switch/i);
  // Appikon (dekor, aria-hidden) og namn står saman med verktøya i éi rad (header-bar), før tittelen.
  const bar = header.slice(header.indexOf('class="header-bar"'), header.indexOf('class="header-title"'));
  assert.match(bar, /<div class="brand"><svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"[^>]*>.*<\/svg><span class="brand-name">Fergeorakelet<\/span><\/div>/s);
  assert.ok(bar.indexOf("brand-name") < bar.indexOf("lang-switch") && bar.indexOf("lang-switch") < bar.indexOf("theme-btn"), "namn, flagg, tema");
  assert.equal((header.match(/class="brand-mark"/g) || []).length, 1);
  assert.match(header, /<h1 id="route-title">[^<]+<\/h1><\/div><p class="eyebrow">Rute 1136<\/p>/, "1136: berre «Rute 1136»");
  const css = read("web/src/styles/header.css");
  assert.match(css, /\.theme-btn \{[^}]*width: 44px;[^}]*height: 44px;/s);
  assert.match(css, /\.header-tools \.lang-btn,\s*\.header-tools \.install-btn \{ min-height: 44px; \}/);
  assert.match(css, /\.brand \{[^}]*min-height: 44px;/s);
  assert.match(css, /\.brand \.brand-mark \{ width: 32px; height: 32px;/);
  assert.match(header, /<div class="header-install"><button[^>]*id="install-btn"/, "installknappen på eiga rad");
  assert.match(css, /@media \(max-width: 419px\) \{[^@]*\.header-tools \.lang-code \{ display: none; \}[^@]*\.header-tools \.lang-btn \{ min-width: 44px;/);
  assert.match(css, /\.header-title h1 \{\s*font-size: 1\.5rem; \/\* 24 px \*\//);
});

test("appnamnet er likt på nn, en og de", () => {
  const initialData = { routes: ROUTES, kombirute: null, messages: null, signalLog: null, connections: null };
  for (const lang of ["nn", "en", "de"]) {
    const html = renderToString(createElement(App, { initialData, initialState: { routeChoice: "1069", lang, override: null, date: null, showPast: true }, memory: memoryOnly() })).replace(/<!-- -->/g, "");
    assert.match(html, /<span class="brand-name">Fergeorakelet<\/span>/, lang);
  }
  setLang("nn");
});
