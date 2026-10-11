// Detaljvindauget for ei avgang: ferja på turen (berre når kjend), overfartstid, ankomst og kjelde. nn/en/de.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { QUAY_COORDS, fixFromAis, fixFromLive } from "../../packages/core/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const repo = new URL("../../", import.meta.url);
const ROUTES = JSON.parse(readFileSync(new URL("tests/fixtures/ruter.json", repo), "utf8"));
// Måndag 12. oktober 2026 kl. 10:50 i Oslo (UTC+2).
const T1050 = Date.UTC(2026, 9, 12, 8, 50);
let FIXED = T1050;
const RealDate = Date;

let server;
let detailModel;
let initialUi;
let planContext;
let memoryOnly;
let legsForDate;
let setLang;

before(async () => {
  server = await createServer({ root, configFile: fileURLToPath(new URL("../vite.config.js", import.meta.url)), logLevel: "error", server: { middlewareMode: true, hmr: false }, appType: "custom" });
  ({ detailModel } = await server.ssrLoadModule("/src/model/controls.js"));
  ({ initialUi } = await server.ssrLoadModule("/src/state.js"));
  ({ planContext, memoryOnly } = await server.ssrLoadModule("/src/model/context.js"));
  ({ legsForDate } = await server.ssrLoadModule("../packages/core/index.js"));
  ({ setLang } = await server.ssrLoadModule("/src/components/i18n.js"));
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

const bearing = (a, b) => {
  const rad = (deg) => (deg * Math.PI) / 180;
  const y = Math.sin(rad(b.longitude - a.longitude)) * Math.cos(rad(b.latitude));
  const x = Math.cos(rad(a.latitude)) * Math.sin(rad(b.latitude)) - Math.sin(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(rad(b.longitude - a.longitude));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};
const F = QUAY_COORDS["Festøya"];
const S = QUAY_COORDS["Solavågen"];
const ais = (mmsi, name, a, b, f, { ageMs = 8000, sog = 9 } = {}) =>
  fixFromAis({ mmsi, name, latitude: a.latitude + (b.latitude - a.latitude) * f, longitude: a.longitude + (b.longitude - a.longitude) * f, sog, cog: sog > 0 ? bearing(a, b) : null, navStatus: 0, timestamp: FIXED - ageMs });

function model({ route = "1069", positions = [], live = null, lang = "nn", pick }) {
  setLang(lang, { persist: false });
  const ui = initialUi({ routeChoice: route, lang });
  const data = { routes: ROUTES, kombirute: null, messages: null, signalLog: null, connections: null, positions, live };
  const leg = legsForDate("2026-10-12", planContext(data, ui)).find(pick);
  assert.ok(leg, "fann turen");
  const content = detailModel(data, ui, memoryOnly(), leg, 10 * 60 + 50, FIXED);
  return { content, texts: content.paragraphs.map((item) => item.text) };
}
const festoyaTrip = (leg) => leg.departure.startsWith("10:40") && leg.from === "Festøya";

test("1069 på overfart: ferja frå AIS-posisjonen til akkurat denne turen, overfartstid og ankomst", () => {
  FIXED = T1050;
  const { content, texts } = model({
    positions: [ais(257090560, "FESTOYA", F, S, 0.5), ais(258220500, "TIDEFJORD", S, F, 0.4)], // Tidefjord går motsett veg: høyrer ikkje til denne turen
    pick: festoyaTrip,
  });
  assert.equal(content.title, "10:40 Festøya → Solavågen");
  assert.deepEqual(texts.slice(0, 3), ["Ferje: Festøya (målt med AIS)", "Ankomst 11:00 · Overfart ca. 20 min", "Vanleg avgang etter rutetabellen."]);
});

test("1069: ferja blir ikkje gjetta (før avgang, seinare tur, utan AIS, gammal posisjon, berre ferja på motsett kurs)", () => {
  const has = (t) => t.some((line) => line.startsWith("Ferje:"));
  FIXED = T1050;
  assert.equal(has(model({ pick: festoyaTrip }).texts), false, "ingen AIS: ingen ferjelinje");
  assert.equal(has(model({ positions: [ais(258220500, "TIDEFJORD", S, F, 0.4)], pick: festoyaTrip }).texts), false, "berre ferja på motsett veg");
  assert.equal(has(model({ positions: [ais(257090560, "FESTOYA", F, S, 0.5, { ageMs: 20 * 60000 })], pick: festoyaTrip }).texts), false, "for gammal posisjon");
  const later = (leg) => leg.departure.startsWith("11:") && leg.from === "Festøya";
  assert.equal(has(model({ positions: [ais(257090560, "FESTOYA", F, S, 0.5)], pick: later }).texts), false, "tur som ikkje har starta");
  const done = (leg) => leg.departure.startsWith("09:") && leg.from === "Festøya";
  assert.equal(has(model({ positions: [ais(257090560, "FESTOYA", F, S, 0.5)], pick: done }).texts), false, "tur som er ferdig");
  // Siste kjende posisjon (ikkje live) blir sagt som det.
  const last = model({ positions: [ais(257090560, "FESTOYA", F, S, 0.5, { ageMs: 2 * 60000 })], pick: festoyaTrip }).texts;
  assert.equal(last[0], "Ferje: Festøya (siste kjende posisjon)");
});

test("1136: ferja som køyrer tabellen (Kvernes), utan AIS-merke; overfartstid frå rutetabellen", () => {
  FIXED = T1050;
  const { texts } = model({ route: "1136", pick: (leg) => leg.from === "Standal" && leg.to === "Trandal" });
  assert.equal(texts[0], "Ferje: Kvernes");
  assert.match(texts[1], /^Ankomst \d\d:\d\d · Overfart ca\. \d+ min$/);
});

test("Entur-posisjon åleine gjev ikkje ferjenamn på 1069 (VehicleRef er ikkje eit namn)", () => {
  FIXED = T1050;
  const live = { latitude: (F.latitude + S.latitude) / 2, longitude: (F.longitude + S.longitude) / 2, recordedAt: new RealDate(FIXED - 5000).toISOString(), journeyRef: "", vehicleRef: "NOR:Vessel:123" };
  assert.ok(fixFromLive(live));
  assert.equal(model({ live, pick: festoyaTrip }).texts.some((line) => line.startsWith("Ferje:")), false);
});

test("nn/en/de: ferjelinje, overfartstid og ankomst på alle språk", () => {
  FIXED = T1050;
  const positions = [ais(257090560, "FESTOYA", F, S, 0.5)];
  assert.deepEqual(model({ positions, lang: "en", pick: festoyaTrip }).texts.slice(0, 3), ["Ferry: Festøya (measured by AIS)", "Arrival 11:00 · Crossing approx. 20 min", "Scheduled departure."]);
  assert.deepEqual(model({ positions, lang: "de", pick: festoyaTrip }).texts.slice(0, 3), ["Fähre: Festøya (per AIS gemessen)", "Ankunft 11:00 · Überfahrt ca. 20 Min.", "Planmäßige Abfahrt."]);
  setLang("nn", { persist: false });
});
