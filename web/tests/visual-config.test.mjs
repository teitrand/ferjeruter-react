// Rutinen for visuelle kontrollar: vanlege telefonar, foldbare og nettbrett (stå og liggjande), lyst/mørkt, normal/130 % tekst.
// 320 px/200 % er berre ein røyktest. Same liste som web/scripts/visual-sweep.mjs og docs/visuell-sjekk.md.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ROUTINE_COMBINATIONS, SANITY, TEXT_SCALES, THEMES, VIEWPORTS } from "../scripts/visual-config.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("rutinebreidder: 360, 390, 412, 430, 440 (telefon), 720/840 (foldbar), 768, 820, 1024, 1180 (nettbrett)", () => {
  const widths = VIEWPORTS.map((v) => v.width);
  for (const w of [360, 390, 412, 430, 440, 768, 820, 1024]) assert.ok(widths.includes(w), `${w} manglar`);
  assert.ok(widths.some((w) => w >= 700 && w <= 840 && w !== 768), "foldbar open");
  assert.ok(!widths.includes(320), "320 er ikkje rutine");
  assert.equal(new Set(widths.map((w, i) => `${w}x${VIEWPORTS[i].height}`)).size, VIEWPORTS.length);
  for (const v of VIEWPORTS) assert.ok(v.width > 0 && v.height > 0 && v.label);
});

test("nettbrett både stå og liggjande; dei vanlegaste fire er med full Nå-sveip", () => {
  assert.ok(VIEWPORTS.some((v) => v.width >= 768 && v.height > v.width), "nettbrett stå");
  assert.ok(VIEWPORTS.some((v) => v.width >= 1024 && v.height < v.width), "nettbrett liggjande");
  for (const w of [360, 390, 412, 430, 768]) assert.equal(VIEWPORTS.find((v) => v.width === w).full, true, `${w} full`);
});

test("lyst og mørkt, normal og 130 % tekst", () => {
  assert.deepEqual(THEMES, ["light", "dark"]);
  assert.deepEqual(TEXT_SCALES, [100, 130]);
  assert.equal(ROUTINE_COMBINATIONS, VIEWPORTS.length * 4);
});

test("320 px/200 % er berre røyktest, ikkje i rutinelista", () => {
  assert.deepEqual([SANITY.width, SANITY.textScale], [320, 200]);
  assert.ok(!TEXT_SCALES.includes(200));
});

test("sveipeskriptet og dokumentet brukar lista (ingen eigen breiddeliste)", () => {
  const script = read("../scripts/visual-sweep.mjs");
  assert.match(script, /from "\.\/visual-config\.mjs"/);
  assert.doesNotMatch(script, /\[\s*3[0-9]{2}\s*,\s*3[0-9]{2}/, "breidder skal ikkje listast i skriptet");
  const doc = readFileSync(new URL("../../docs/visuell-sjekk.md", import.meta.url), "utf8");
  for (const v of VIEWPORTS) assert.ok(doc.includes(String(v.width)), `${v.width} i docs/visuell-sjekk.md`);
  assert.match(doc, /320 px \/ 200 % er ikkje rutine/);
});

test("layout-reglar frå sveipen: éi kolonne på nettbrett, grunnskrift frå 700 px, meldingsraden bryt i staden for å overlappe", () => {
  const css = readFileSync(new URL("../../assets/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.site-header,\s*main,\s*\.site-footer \{\s*width: min\(40rem, calc\(100% - 2rem\)\);/, "topp, innhald og botn like breie");
  assert.match(css, /@media \(min-width: 700px\) \{\s*html \{ font-size: 112\.5%; \}/);
  assert.match(css, /@media \(min-width: 641px\) \{\s*\.site-header \{[^}]*"tools tools"/s, "topprada får eiga line òg på nettbrett");
  assert.match(css, /\.messages-bar-head \{[^}]*flex-wrap: wrap;/s);
  assert.match(css.match(/\.messages-bar-title \{[^}]*\}/s)[0], /flex: 1 1 auto;[\s\S]*overflow-wrap: anywhere/);
});
