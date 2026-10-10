import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Kontrastsjekk av tema-tokens (WCAG 2.x). Les dei faktiske CSS-filene: lys = :root-blokkene, mørk = lys + html[data-theme="dark"].
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const FILES = ["../../assets/styles.css", "../src/styles/crossing.css", "../src/styles/nowcard.css", "../src/styles/picker.css"].map(read);
const DARK = read("../src/styles/theme.css");

function declarations(block) {
  const out = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*((?:[^;"(]|\([^)]*\)|"[^"]*")+);/g)) out[m[1]] = m[2].trim();
  return out;
}
function rootBlocks(css) {
  return [...css.matchAll(/(?:^|\n):root\s*\{([\s\S]*?)\n\}/g)].map((m) => declarations(m[1]));
}
const light = Object.assign({}, ...FILES.flatMap(rootBlocks));
const darkBlock = DARK.match(/html\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)[1];
const darkOverrides = declarations(darkBlock);
const dark = { ...light, ...darkOverrides };

function resolve(tokens, value, depth = 0) {
  const m = value.match(/^var\((--[\w-]+)\)$/);
  if (!m) return value;
  assert.ok(depth < 8 && tokens[m[1]], `ukjend token ${m[1]}`);
  return resolve(tokens, tokens[m[1]], depth + 1);
}
function rgb(tokens, ref) {
  const v = ref.startsWith("--") ? resolve(tokens, tokens[ref]) : ref;
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  assert.ok(hex, `${ref} er ikkje ein heksfarge: ${v}`);
  let h = hex[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
function ratio(tokens, fg, bg) {
  const [a, b] = [lum(rgb(tokens, fg)), lum(rgb(tokens, bg))];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const SURFACES = ["--paper", "--card"];
// [forgrunn, bakgrunnar, minimum]. Tekst ≥ 4,5:1; ikon/ramme/graf ≥ 3:1.
const TEXT = [
  ["--ink", [...SURFACES, "--card-cancel", "--sel-row", "--na-top", "--na-bottom"]],
  ["--muted", [...SURFACES, "--card-cancel", "--na-top", "--na-bottom"]],
  ["--strong", [...SURFACES, "--soft-bg", "--na-top", "--na-bottom", "--sel-row"]],
  ["--link", SURFACES],
  ["--ok-fg", [...SURFACES, "--ok-bg", "--ok-soft", "--na-top", "--na-bottom"]],
  ["--delay-fg", [...SURFACES, "--delay-bg", "--delay-soft", "--na-top", "--na-bottom"]],
  ["--stop-fg", [...SURFACES, "--stop-bg", "--card-cancel", "--na-top", "--na-bottom"]],
  ["--info-fg", [...SURFACES, "--info-bg", "--na-top", "--na-bottom"]],
  ["--unknown-fg", ["--unknown-bg", ...SURFACES, "--na-top", "--na-bottom"]],
  ["--sel-fg", ["--sel-bg", "--send-hover"]],
  ["--foam", ["--page"]],
  ["#ffffff", ["--page", "--stop-solid"]],
  ["#fffaf1", ["--stop-solid"]],
  ["#f6d98a", ["--page"]], // .lede-warn
  ["--soon-fg", ["--soon-bg"]],
  ["--muted", ["--soon-bg"]],
];
const GRAPHIC = [
  ["--ok", SURFACES],
  ["--delay", SURFACES],
  ["--stop", SURFACES],
  ["--info", SURFACES],
  ["--water", SURFACES],
  ["--quay", ["--na-top", "--na-bottom"]],
  ["--ferry-outline", ["--na-top", "--na-bottom"]],
  ["--ferry-red", ["--na-top", "--na-bottom"]],
  ["--unknown-line", ["--na-top", "--na-bottom"]],
  ["--soon-line", ["--soon-bg"]],
];

for (const [name, tokens] of [["lyst", light], ["mørkt", dark]]) {
  test(`${name} tema: tekst ≥ 4,5:1 mot flata`, () => {
    const fails = [];
    for (const [fg, bgs] of TEXT) for (const bg of bgs) {
      const r = ratio(tokens, fg, bg);
      if (r < 4.5) fails.push(`${fg} på ${bg}: ${r.toFixed(2)}`);
    }
    assert.deepEqual(fails, []);
  });
  test(`${name} tema: statusfargar, kai og ferje ≥ 3:1 (ikkje berre farge, men synleg)`, () => {
    const fails = [];
    for (const [fg, bgs] of GRAPHIC) for (const bg of bgs) {
      const r = ratio(tokens, fg, bg);
      if (r < 3) fails.push(`${fg} på ${bg}: ${r.toFixed(2)}`);
    }
    assert.deepEqual(fails, []);
  });
}

test("mørkt tema: sidebakgrunn, panel og kort er tre ulike nivå, mørkare enn teksten", () => {
  const [page, paper, card] = ["--page", "--paper", "--card"].map((t) => lum(rgb(dark, t)));
  assert.ok(page < paper && paper < card, "page < paper < card");
  assert.ok(lum(rgb(dark, "--ink")) > 0.6);
});

test("mørkt tema: kvar overstyring finst som token i lyst tema (ingen skrivefeil), og rollene er dekt", () => {
  for (const key of Object.keys(darkOverrides)) assert.ok(key in light, `${key} manglar i lyst tema`);
  const REQUIRED = ["--page", "--paper", "--card", "--card-cancel", "--ink", "--muted", "--strong", "--link", "--sel-bg", "--sel-fg",
    "--ok-fg", "--ok-bg", "--delay-fg", "--delay-bg", "--stop-fg", "--stop-bg", "--info-fg", "--info-bg", "--na-top", "--na-bottom",
    "--na-mountain", "--quay", "--ferry-outline", "--unknown-fg", "--unknown-bg", "--track", "--sel-row", "--soon-bg", "--handle"];
  for (const key of REQUIRED) assert.ok(key in darkOverrides, `${key} manglar i det mørke temaet`);
});

test("honest fargesemantikk: grøn live, oransje forseinka, raud avlyst, blå utanfor ruta er ulike fargetonar i begge tema", () => {
  const hue = ([r, g, b]) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (!d) return 0;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  for (const tokens of [light, dark]) {
    const [ok, delay, stop, info] = ["--ok-fg", "--delay-fg", "--stop-fg", "--info-fg"].map((t) => hue(rgb(tokens, t)));
    assert.ok(ok > 140 && ok < 180, `grøn ${ok}`);
    assert.ok(delay > 20 && delay < 45, `oransje ${delay}`);
    assert.ok(stop < 12 || stop > 345, `raud ${stop}`);
    assert.ok(info > 195 && info < 225, `blå ${info}`);
  }
});
