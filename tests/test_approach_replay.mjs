// «På veg til X» frå AIS-destinasjonen (14.10.2026: Kvernes i 10,9 knop mot Valderøya, appen sa «utanfor ruta»),
// og at statuslinja tek neste avgang frå dei same turane som lista.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  approachTo,
  crossingBadge,
  fixFromAis,
  positionSourceView,
  statusFromPosition,
} from "../packages/core/index.js";
import { memoryOnly } from "../web/src/model/context.js";
import { ledeModel } from "../web/src/model/header.js";
import { composeNowCard } from "../web/src/model/nowcard.js";
import { buildTimeline } from "../web/src/model/timeline.js";
import { initialUi } from "../web/src/state.js";
import { osloMs } from "./helpers/replay.mjs";
import { appVersion } from "./helpers/version.mjs";

const { setLang } = await import(`../assets/i18n.js?v=${appVersion()}`);
setLang("nn");

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const QUAYS = ["Standal", "Trandal", "Sæbø", "Skår", "Leknes", "Valderøya", "Store Kalvøy"];
const NOW = osloMs("2026-10-14", 11 * 60 + 20);
// Om lag 5,1 km sør for Valderøya, lenger enn 4 km frå alle kaier: «utanfor ruta» utan destinasjon.
const SOUTH = { latitude: 62.45, longitude: 6.128569 };

function kvernes({ ageMs = 10_000, sog = 10.9, cog = 0, destination = "VALDEROY-STORE KALVO", at = SOUTH } = {}) {
  return fixFromAis({ mmsi: 257297400, name: "KVERNES", ...at, sog, cog, navStatus: 0, destination, timestamp: NOW - ageMs });
}

const statusOf = (fix) =>
  statusFromPosition({ at: 0, short: "Ferja ligg til kai på Standal", text: "Ferja ligg til kai på Standal." }, { running: [], fixes: [fix], quays: QUAYS, now: 680, nowMs: NOW });

test("14.10: på veg til Valderøya med framkomst rekna frå avstand og fart, same tekst i statuslinja og kortet", () => {
  const fix = { ...kvernes(), eta: "2026-10-14T12:30:00Z" }; // AIS-ETA skal ikkje brukast
  const approach = approachTo(fix, QUAYS, NOW);
  assert.equal(approach.quay, "Valderøya");
  // 5,1 km / 10,9 knop ≈ 15 min etter posisjonen (11:19:50) → 11:34, ikkje 14:30 frå ETA.
  assert.equal(approach.arrival, "11:34");
  const view = positionSourceView([fix], NOW, null, QUAYS);
  assert.equal(view.state, "outside");
  assert.equal(crossingBadge(view), "Destinasjon frå AIS");
  const status = statusOf(fix);
  assert.equal(status.short, "På veg til Valderøya · framme ca. 11:34");
  assert.equal(status.outside, true);
  const card = composeNowCard({ mode: "outside", place: "", leg: null, quay: null }, view);
  assert.equal(card.main, status.short);
  assert.equal(card.badge.text, "Destinasjon frå AIS");
  assert.equal(card.badge.tone, "approach");
  assert.equal(card.scene.kind, "line");
  assert.equal(card.scene.to, "Valderøya");
});

test("gammal destinasjon: ferja går bort frå kaia, då er ho framleis utanfor ruta", () => {
  const fix = kvernes({ cog: 180 });
  assert.equal(approachTo(fix, QUAYS, NOW), null);
  assert.equal(statusOf(fix).short, "Ferja er utanfor ruta");
  assert.match(crossingBadge(positionSourceView([fix], NOW, null, QUAYS)), /^Utanfor ruta/);
});

test("under 2 knop: på veg, men inga tid", () => {
  const fix = kvernes({ sog: 1.5 });
  assert.equal(approachTo(fix, QUAYS, NOW).arrival, null);
  assert.equal(statusOf(fix).short, "På veg til Valderøya");
});

test("destinasjonskai som ikkje er på ruta gjev ingen «På veg til»", () => {
  assert.equal(approachTo(kvernes({ destination: "ALESUND" }), QUAYS, NOW), null);
  assert.equal(approachTo(kvernes(), ["Standal", "Trandal"], NOW), null);
  assert.equal(statusOf(kvernes({ destination: "ALESUND" })).short, "Ferja er utanfor ruta");
});

test("AIS-melding for gammal til live: merket byter til «Siste kjende», for gammal til siste kjende: ingen «På veg til»", () => {
  const stale = kvernes({ ageMs: 2 * 60_000 });
  const view = positionSourceView([stale], NOW, null, QUAYS);
  assert.equal(view.approach.quay, "Valderøya");
  assert.equal(crossingBadge(view), "Siste kjende frå AIS · 2 min sidan");
  const card = composeNowCard({ mode: "outside", place: "", leg: null, quay: null }, view);
  assert.equal(card.badge.text, "Siste kjende frå AIS · 2 min sidan");
  assert.equal(approachTo(kvernes({ ageMs: 10 * 60_000 }), QUAYS, NOW), null);
});

const DATA = () => ({
  routes: read("./fixtures/ruter_2026-10-14.json"),
  kombirute: null,
  messages: null,
  signalLog: read("./fixtures/signalturar_2026-10-14.json"),
});

function atOslo(ms, fn) {
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [ms]));
    }
    static now() {
      return ms;
    }
  };
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

test("«På veg til» rører ikkje status for signalturar i lista", () => {
  const minutes = 11 * 60 + 20;
  const ui = initialUi();
  const rows = (positions) =>
    atOslo(NOW, () =>
      buildTimeline({ ...DATA(), positions }, ui, memoryOnly(), { now: minutes })
        .rows.filter((row) => row.kind === "dep" && row.leg?.signal)
        .map(({ leg, ...row }) => JSON.stringify(row)),
    );
  const without = rows([]);
  assert.ok(without.length > 0);
  assert.deepEqual(rows([kvernes()]), without);
});

test("statuslinja tek neste avgang frå dei same turane som lista (signaltur etter fristen blir ikkje hoppa over)", () => {
  const minutes = 10 * 60;
  const ms = osloMs("2026-10-14", minutes);
  const ui = initialUi();
  const [lede, first] = atOslo(ms, () => [
    ledeModel(DATA(), ui, memoryOnly(), minutes),
    buildTimeline(DATA(), ui, memoryOnly(), { now: minutes }).rows.find((row) => row.kind === "dep" && !row.past),
  ]);
  assert.equal(first.time, "11:10");
  assert.equal(lede.next.time, first.time);
  assert.equal(lede.next.from, first.from);
});
