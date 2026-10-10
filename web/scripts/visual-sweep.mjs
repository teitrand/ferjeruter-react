#!/usr/bin/env node
// Visuell sveip med headless Chromium (ikkje del av CI; krev playwright-core og ein Chromium).
//
//   npm run build:web && npm run preview -w web -- --port 4173 &
//   PLAYWRIGHT_CORE=/sti/til/playwright-core/index.mjs CHROME=/sti/til/chrome \
//     node web/scripts/visual-sweep.mjs [--base http://localhost:4173/] [--out /tmp/sveip] [--quick] [--sanity] [--width 360,768]
//
// For kvar kombinasjon av breidd × tema × tekststorleik (sjå visual-config.mjs) lastar han appen med fast klokke og
// mocka AIS/meldingar, tek skjermbilete av hovudtilstandane og køyrer automatiske sjekkar:
//   overflyt til sida, element som stikk ut, tekst som er klipt, dialogar utanfor skjermen, og at «No»-kortet,
//   botnteksten og «Om dataa» kan nåast utan å bli dekt av det faste sambandskortet.
// Utdata: PNG-ar + rapport.json i --out; exit 1 om ein sjekk feilar.
import { mkdirSync, writeFileSync } from "node:fs";
import { SANITY, THEMES, TEXT_SCALES, VIEWPORTS } from "./visual-config.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);
const BASE = arg("base", "http://localhost:4173/");
const OUT = arg("out", "/tmp/visuell-sveip/");
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || "playwright-core");
mkdirSync(OUT, { recursive: true });

const Q = { Standal: [62.266216, 6.423177], Trandal: [62.260997, 6.500688] };
const at = (h, m) => Date.UTC(2026, 9, 10, h - 2, m, 0);
const pos = (f) => [Q.Standal[0] + (Q.Trandal[0] - Q.Standal[0]) * f, Q.Standal[1] + (Q.Trandal[1] - Q.Standal[1]) * f];
const ais = (now, ageSec, [lat, lon], speed = 0) => ({ schema: 1, lines: { 1136: { ais: { source: "ais", mmsi: 257000000, latitude: lat, longitude: lon, speedKn: speed, courseDeg: 90, navStatus: 0, msgtime: new Date(now - ageSec * 1000).toISOString() } } } });
const message = (id, severity, text) => ({ id, heading: "Standal – Trandal", text, publishedAt: "2026-10-10T13:00:00+02:00", validFrom: "2026-10-10T10:00:00+00:00", validTo: "2026-10-11T10:00:00+00:00", countyNumber: 15, connectionNumber: 1136, important: false, severity, isRoute1136: true, isLocal: true, isRouteControl: false, routeMode: "1136", routeWindow: null, activateAt: null, vessel: null, routeSwitch: null });
const MESSAGES = { source: "x", fetchedAt: "2026-10-10T14:00:00+00:00", messages: [
  message("a", "cancelled", "Avgangen 17:45 frå Sæbø er innstilt grunna teknisk feil."),
  message("b", "delay", "Det er opptil 20 minutt forseinking grunna høg trafikk."),
  message("c", "normal", "Det vert normal drift i sambandet frå kl. 18:00."),
] };

// Nå-kortet: alle seks tilstandar.
export const NA_STATES = {
  "a-dag-ved-kai": { t: at(15, 50), json: (n) => ais(n, 12, Q.Standal) },
  "b-natt-ved-kai": { t: at(22, 40), json: (n) => ais(n, 22, Q.Trandal) },
  "c-pa-veg": { t: at(16, 12), json: (n) => ais(n, 8, pos(0.5), 9) },
  "d-utanfor-ruta": { t: at(16, 12), json: (n) => ais(n, 15, [62.4, 6.2], 11) },
  "e-ukjend": { t: at(16, 12), json: (n) => ais(n, 8 * 60, pos(0.4), 9) },
  "f-berekna": { t: at(16, 12), json: () => ({ schema: 1, lines: {} }) },
};
const PAGE_STATE = NA_STATES["c-pa-veg"];

const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ["--no-sandbox"] });
const report = [];
let failures = 0;

async function load(sc, { width, height, theme, textScale }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, locale: "nb-NO", timezoneId: "Europe/Oslo", colorScheme: theme });
  const page = await ctx.newPage();
  await page.addInitScript((pct) => {
    const css = `html{font-size:${pct}% !important}`;
    const add = () => { const s = document.createElement("style"); s.textContent = css; document.documentElement.appendChild(s); };
    if (pct !== 100) (document.documentElement ? add() : document.addEventListener("DOMContentLoaded", add));
  }, textScale);
  await page.clock.install({ time: sc.t });
  await page.route("**/v1/latest*", (r) => r.fulfill({ json: sc.json(sc.t), headers: { "access-control-allow-origin": "*" } }));
  await page.route("**/trafikkmeldinger.json*", (r) => r.fulfill({ json: MESSAGES, headers: { "access-control-allow-origin": "*" } }));
  await page.route("**/api.entur.io/**", (r) => r.abort());
  await page.goto(BASE, { waitUntil: "load" });
  await page.clock.runFor(1500);
  await page.waitForSelector("#na-card");
  await page.waitForTimeout(250);
  return { page, ctx };
}

// Kjøyrer i sida: samlar funn utan å endre noko.
const audit = (page, scope) => page.evaluate((scope) => {
  const vw = document.documentElement.clientWidth;
  const issues = [];
  const name = (e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).join(".") : ""}`;
  const clipped = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p); if (o.overflowX !== "visible") return true; } return false; };
  const root = scope ? document.querySelector(scope) : document.body;
  if (!root) return [`${scope}: finst ikkje`];
  if (!scope && document.documentElement.scrollWidth > vw + 1) issues.push(`sida er breiare enn skjermen: ${document.documentElement.scrollWidth} > ${vw}`);
  for (const e of root.querySelectorAll("*")) {
    const cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden" || e.closest(".visually-hidden,[hidden]")) continue;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (cs.position !== "fixed" && !clipped(e) && (r.right > vw + 1 || r.left < -1)) issues.push(`stikk ut: ${name(e)} (${Math.round(r.left)}–${Math.round(r.right)} av ${vw})`);
    const hidesOverflow = cs.overflowX === "hidden" || cs.overflowX === "clip";
    if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && (hidesOverflow || cs.textOverflow === "ellipsis") && !e.closest("svg")) {
      // Berre tekst som faktisk ligg utanfor boksen (dekorative, transformerte element kan gjere scrollWidth større utan å klippe noko).
      const cut = [...e.querySelectorAll("*"), e].some((leaf) => {
        if (leaf.closest("svg,.visually-hidden") || leaf.children.length || !(leaf.textContent || "").trim()) return false;
        const lr = leaf.getBoundingClientRect();
        return lr.width && (lr.right > r.right + 1 || lr.left < r.left - 1);
      });
      if (cut) issues.push(`klipt tekst: ${name(e)} (${e.scrollWidth} > ${e.clientWidth})`);
    }
  }
  // Tekst som ligg over anna tekst (t.d. tittel som stikk ut under eit merke).
  const boxes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || !el || el.closest(".route-bar,.visually-hidden,[hidden],svg,script,style") || getComputedStyle(el).visibility === "hidden") continue;
    const closed = el.closest("details:not([open])"); // innhaldet i lukka <details> har ingen boks
    if (closed && !el.closest("summary")) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.width > 2 && r.height > 2) boxes.push({ el, r, text: n.textContent.trim().slice(0, 18) });
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
    const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (w > 3 && h > 3 && (w * h) / Math.min(a.r.width * a.r.height, b.r.width * b.r.height) > 0.2) issues.push(`tekst overlappar: «${a.text}» og «${b.text}»`);
  }
  return [...new Set(issues)].slice(0, 12);
}, scope);

// «No»-kortet, botnteksten og «Om dataa» må kunne nåast utan å liggje under det faste kortet.
const reach = (page) => page.evaluate(async () => {
  const issues = [];
  const bar = document.querySelector(".route-bar");
  const fixed = bar && getComputedStyle(bar).position === "fixed";
  const barTop = () => (fixed ? bar.getBoundingClientRect().top : Infinity);
  const vh = window.innerHeight;
  const card = document.querySelector("#na-card");
  card.scrollIntoView({ block: "start" });
  await new Promise((r) => setTimeout(r, 50));
  let r = card.getBoundingClientRect();
  if (r.height <= vh - (fixed ? bar.getBoundingClientRect().height : 0) - 8 && r.bottom > barTop() + 1) issues.push(`Nå-kortet blir dekt av sambandskortet (botn ${Math.round(r.bottom)} > ${Math.round(barTop())})`);
  scrollTo(0, document.documentElement.scrollHeight);
  await new Promise((r2) => setTimeout(r2, 50));
  const last = [...document.querySelectorAll(".site-footer p, .site-footer details, .site-footer button, .site-footer a")].pop();
  if (last) { r = last.getBoundingClientRect(); if (r.bottom > barTop() + 1) issues.push(`botnteksten ligg under sambandskortet (${Math.round(r.bottom)} > ${Math.round(barTop())})`); }
  return issues;
});

async function check(label, issues, combo) {
  if (issues.length) { failures += issues.length; console.log(`✗ ${label}`); for (const i of issues) console.log(`    ${i}`); }
  report.push({ ...combo, label, issues });
}

async function sweep(combo, { quick = false } = {}) {
  const { width, theme, textScale } = combo;
  const tag = `${width}x${combo.height}-${theme}-${textScale}`;
  const shot = (page, name, opts = {}) => page.screenshot({ path: `${OUT}${tag}-${name}.png`, ...opts });
  // Nå-kortet i alle tilstandar
  for (const [name, sc] of Object.entries(NA_STATES)) {
    if (quick && !["c-pa-veg", "e-ukjend"].includes(name)) continue;
    const { page, ctx } = await load(sc, combo);
    await check(`${tag} Nå ${name}`, [...(await audit(page, "#na-card")), ...(await reach(page))], combo);
    await page.evaluate(() => document.querySelector("#na-card").scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    await shot(page, `na-${name}`);
    await ctx.close();
  }
  // Sida: topp (flagg og temaknapp), heile, meldingar, ark, dialogar, botn
  const { page, ctx } = await load(PAGE_STATE, combo);
  await check(`${tag} sida`, await audit(page), combo);
  await shot(page, "topp");
  await shot(page, "heile", { fullPage: true });
  await check(`${tag} toppen`, await audit(page, ".site-header"), combo);
  await page.locator(".site-header").screenshot({ path: `${OUT}${tag}-toppen.png` });
  // Temaknappen bladar Enhet → Lys → Mørk
  const before = await page.locator(".theme-btn").getAttribute("data-theme-pref");
  await page.click(".theme-btn"); await page.waitForTimeout(150);
  if ((await page.locator(".theme-btn").getAttribute("data-theme-pref")) === before) { failures += 1; console.log(`✗ ${tag} temaknappen bladar ikkje`); }
  await page.click(".theme-btn"); await page.click(".theme-btn"); await page.waitForTimeout(150);
  const bar = page.locator(".messages-bar");
  if (await bar.count()) {
    await bar.first().click(); await page.waitForTimeout(250);
    await check(`${tag} meldingspanel`, await audit(page, ".panel-messages"), combo);
    await page.evaluate(() => document.querySelector(".panel-messages").scrollIntoView({ block: "start" }));
    await shot(page, "meldingar");
    await bar.first().click(); await page.waitForTimeout(150);
  }
  await page.evaluate(() => scrollTo(0, 0));
  await page.click("#route-card"); await page.waitForTimeout(450);
  await check(`${tag} samband-ark`, await audit(page, "#route-sheet"), combo);
  await shot(page, "ark");
  await page.keyboard.press("Escape"); await page.waitForTimeout(250);
  const dep = page.locator(".stop-dep .stop-detail").first();
  if (await dep.count()) {
    await dep.scrollIntoViewIfNeeded(); await dep.click(); await page.waitForTimeout(300);
    await check(`${tag} avgangsdetalj`, await audit(page, ".departure-dialog"), combo);
    await shot(page, "detalj");
    await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  }
  const fb = page.locator(".feedback-link");
  if (await fb.count()) {
    await fb.first().scrollIntoViewIfNeeded(); await fb.first().click(); await page.waitForTimeout(300);
    await check(`${tag} tilbakemelding`, await audit(page, ".feedback-dialog"), combo);
    await shot(page, "tilbakemelding");
    await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  }
  await check(`${tag} botn (Om dataa, fotnotar)`, await reach(page), combo);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(100);
  await shot(page, "botn");
  await ctx.close();
}

if (flag("sanity")) {
  // Røyktest, ikkje rutine.
  await sweep({ width: SANITY.width, height: SANITY.height, theme: SANITY.theme, textScale: SANITY.textScale }, { quick: true });
} else {
  const only = arg("width", "").split(",").filter(Boolean).map(Number);
  for (const vp of VIEWPORTS.filter((v) => !only.length || only.includes(v.width))) for (const theme of THEMES) for (const textScale of TEXT_SCALES) await sweep({ ...vp, theme, textScale }, { quick: flag("quick") || !vp.full });
}
await browser.close();
writeFileSync(`${OUT}rapport.json`, JSON.stringify(report, null, 1));
console.log(failures ? `\n${failures} funn (sjå ${OUT}rapport.json)` : `\nIngen funn. ${report.length} sjekkar, bilete i ${OUT}`);
process.exit(failures ? 1 : 0);
