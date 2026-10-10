// Samband 1069 Festøya–Solavågen (FRAM, Norled): tabell, kaier, ingen korrespondanse, meldingar og AIS-grensa.
// Same mønster som 1049, men tre ferjer går om kvarandre, så AIS blir ikkje brukt enno (sjå withSanntid).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ALLOWED_MODES,
  CHOOSABLE_ROUTES,
  LINE_QUAYS,
  LIVE_VM_URLS,
  QUAY_COORDS,
  ROUTE_CATALOG,
  STOP_PLACES,
  activeMode,
  activePlan,
  cancellationQuery,
  chosenRoute,
  distanceMeters,
  isMultiFerryRoute,
  isRouteControl,
  legsForDate,
  timelineEvents,
  knownQuays,
  legsForMode,
  liveFetchUrls,
  matchesChosenRouteNotice,
  normalizeFjord1Node,
  plausibleRoute,
  routeFootnotes,
  routeNameFlags,
  routeOverride,
  signalPhone,
  tableName,
  visibleConnectionLines,
} from "../../packages/core/index.js";
import { AIS_UNATTRIBUTED_LINES, withSanntid } from "../src/model/sanntid.js";

const ROUTES = JSON.parse(readFileSync(new URL("../../tests/fixtures/ruter.json", import.meta.url), "utf8"));
const MON = "2026-10-12";
const NOW = Date.UTC(2026, 9, 12, 8, 0);
const ctx = (extra = {}) => ({ routes: ROUTES, kombirute: null, messages: [], routeChoice: "1069", override: null, fromQuery: null, nowMs: NOW, today: MON, date: MON, ...extra });
const times = (date, from) => legsForMode("1069", date, ctx()).filter((leg) => leg.from === from).map((leg) => leg.departure.slice(0, 5)).sort();

test("1069: rutetabellen har Festøya↔Solavågen utan signalturar, ei tabell, 20 minutt per overfart", () => {
  const line = ROUTES.lines["1069"];
  assert.equal(line.publicCode, "1069");
  assert.ok(line.legs.every((leg) => leg.signal === null));
  assert.deepEqual([...new Set(line.legs.map((leg) => leg.from))].sort(), ["Festøya", "Solavågen"]);
  const legs = legsForMode("1069", MON, ctx());
  assert.equal(legs.length, 104, "52 turar kvar veg på kvardag");
  assert.ok(legs.every((leg) => leg.table === "1069"));
  assert.deepEqual([times(MON, "Festøya")[0], times(MON, "Festøya").at(-1)], ["00:10", "23:10"]);
  assert.deepEqual([times(MON, "Solavågen")[0], times(MON, "Solavågen").at(-1)], ["00:40", "23:40"]);
  assert.ok(legs.every((leg) => {
    const [dh, dm] = leg.departure.split(":").map(Number);
    const [ah, am] = leg.arrival.split(":").map(Number);
    return (ah * 60 + am) - (dh * 60 + dm) === 20 || (ah * 60 + am) + 1440 - (dh * 60 + dm) === 20;
  }), "20 minutt");
  assert.ok(legsForMode("1049", MON, ctx()).every((leg) => leg.to !== "Solavågen"), "1049 får ikkje 1069-turar");
  assert.ok(legsForMode("1136", MON, ctx()).every((leg) => leg.from !== "Solavågen"));
  assert.ok(times("2026-10-10", "Festøya").length < times(MON, "Festøya").length, "laurdag har færre turar");
});

test("1069: valt samband gjev eigen tabell, òg når meldingane seier kombirute (meldingane styrer ikkje 1069)", () => {
  assert.ok(CHOOSABLE_ROUTES.has("1069") && ALLOWED_MODES.has("1069"));
  assert.deepEqual(ROUTE_CATALOG.find((route) => route.id === "1069"), { id: "1069", line: "1069", needsData: true, independent: true, multiFerry: true });
  assert.deepEqual(ROUTE_CATALOG.filter((route) => isMultiFerryRoute(route.id)).map((route) => route.id), ["1069"], "berre 1069 har fleire ferjer om kvarandre");
  assert.equal(chosenRoute(ctx()), "1069");
  assert.equal(chosenRoute(ctx({ routes: { ...ROUTES, lines: { 1136: ROUTES.lines["1136"] } } })), "1136", "utan data fell vala tilbake");
  const kombiMsg = [{ id: "k", heading: "Kombinasjonsrute", text: "Kombinert rute 1135 og 1136 frå klokka 10:00", publishedAt: "2026-10-12T05:00:00Z", validFrom: "2026-10-12T05:00:00Z", isLocal: true, isRouteControl: true, routeMode: "kombi", routeSwitch: null }];
  assert.deepEqual(activePlan(MON, ctx({ messages: kombiMsg })), { mode: "1069", switch: null, notice: null, uncertain: false });
  assert.equal(activeMode(ctx({ routeChoice: "1136", override: "1069" })), "1069", "?rute=1069");
  assert.equal(tableName("1069"), "1069");
});

test("1069: ingen korrespondanse og ingen telefon frå Kvernes", () => {
  assert.deepEqual(visibleConnectionLines([], null, MON, ctx()), []);
  assert.equal(signalPhone({ table: "1069" }, ctx()), "");
  assert.equal(signalPhone({ table: "1069", signal: { phone: "11 22 33 44" } }, ctx()), "11 22 33 44");
});

test("1069: kaier, stoppestader, Entur-adresse og kaikoordinatar", () => {
  for (const quay of ["Solavågen", "Festøya"]) {
    assert.ok(LINE_QUAYS.includes(quay) && knownQuays(ctx()).includes(quay), quay);
    assert.match(STOP_PLACES[quay], /^NSR:StopPlace:\d+$/);
  }
  assert.equal(STOP_PLACES.Solavågen, "NSR:StopPlace:41550");
  assert.equal(STOP_PLACES.Festøya, "NSR:StopPlace:38754", "Festøya er delt med 1049");
  assert.deepEqual(liveFetchUrls("1069"), [LIVE_VM_URLS[1069]]);
  assert.match(LIVE_VM_URLS[1069], /LineRef=MOR:Line:1069$/);
  const query = cancellationQuery(["Solavågen"]);
  assert.match(query, /NSR:StopPlace:41550/);
  assert.match(query, /MOR:Line:1069/);
  // Entur: 4,4 km mellom kaiene.
  const span = distanceMeters(QUAY_COORDS.Festøya.latitude, QUAY_COORDS.Festøya.longitude, QUAY_COORDS.Solavågen.latitude, QUAY_COORDS.Solavågen.longitude);
  assert.ok(span > 4000 && span < 4600, `kaiavstand ${Math.round(span)} m`);
});

test("1069: Plausible-namn, ?rute=1069 og papirruteplan frå FRAM", () => {
  assert.equal(plausibleRoute("1069"), "festoya-solavagen");
  assert.equal(routeOverride({ href: "https://teitrand.github.io/ferjeruter-react/?rute=1069", pathname: "/ferjeruter-react/", hostname: "teitrand.github.io" }), "1069");
  const notes = routeFootnotes("1069");
  assert.match(notes.pdf.href, /^https:\/\/frammr\.no\/.*1069-festoya-solavagen/);
  assert.equal(notes.pdf.text, "frammr.no");
});

const msg = (heading, text) => normalizeFjord1Node({ id: heading, heading, content: text, date: "12.10.2026 07:00:00", validFrom: Date.parse("2026-10-12T05:00:00Z") / 1000, validTo: Date.parse("2026-10-12T13:00:00Z") / 1000 });

test("1069-melding: «Festøya–Solavågen» er berre 1069, «Festøya–Hundeidvik» berre 1049, «Festøya» åleine begge", () => {
  const sol = routeNameFlags({ heading: "Festøya–Solavågen: innstilt", text: "Avgangen 19:40 er innstilt." });
  assert.deepEqual([sol.named1069, sol.named1049, sol.named1136, sol.named1135], [true, false, false, false]);
  const hund = routeNameFlags({ heading: "Festøya–Hundeidvik: forseinka", text: "Ferja er forseinka." });
  assert.deepEqual([hund.named1049, hund.named1069], [true, false]);
  const both = routeNameFlags({ heading: "Festøya ferjekai stengd", text: "Kaia er stengd." });
  assert.deepEqual([both.named1049, both.named1069], [true, true]);
  assert.equal(routeNameFlags({ heading: "Melding", text: "Sambandet 1069 går ikkje" }).named1069, true, "nummeret i teksten");
  assert.equal(routeNameFlags({ heading: "Melding", text: "Det er mykje trafikk ved Solavågen" }).named1069, false, "staden i brødteksten er ikkje nok");
  assert.equal(matchesChosenRouteNotice({ heading: "Solavågen stengd" }, "1069"), true);
  assert.equal(matchesChosenRouteNotice({ heading: "Solavågen stengd" }, "1049"), false);
  assert.equal(matchesChosenRouteNotice({ heading: "Solavågen stengd" }, "1136"), false);
});

test("1069-melding styrer aldri 1136/1135/kombirute", () => {
  const m = msg("Festøya–Solavågen", "Ferja går ikkje etter 22:00");
  assert.equal(m.isLocal, true);
  assert.equal(m.isRouteControl, false);
  assert.equal(m.isRoute1136, false);
  assert.equal(m.routeSwitch, null);
  assert.equal(isRouteControl(m), false);
  assert.equal(matchesChosenRouteNotice(m, "1069"), true);
});

test("AIS: 1069 har ingen AIS-kjelde i appen (tre ferjer, ein posisjon per linje frå workeren); 1049 og 1136 held fram", () => {
  assert.deepEqual([...AIS_UNATTRIBUTED_LINES], ["1069"]);
  const fix = (vessel) => ({ source: "ais", latitude: 62.39, longitude: 6.33, at: NOW, speedKn: 8, course: 0, atStop: null, moored: false, journeyRef: "", expectedArrival: "", vessel });
  const state = { entries: [{ line: "1069", fix: fix("257090560") }, { line: "1049", fix: fix("258408000") }, { line: "1136", fix: fix("257297400") }], failed: false, loaded: true };
  assert.deepEqual(withSanntid({}, state, "1069").positions, []);
  assert.deepEqual(withSanntid({}, state, "1049").positions.map((item) => item.vessel), ["258408000"]);
  assert.deepEqual(withSanntid({}, state, "1136").positions.map((item) => item.vessel), ["257297400"]);
  assert.equal(withSanntid({}, state, "1069").sanntidOn, true);
});

test("1069: tidslinja har berre avgangar (ingen liggetid eller tomtur mellom overlappande turar)", () => {
  const legs = legsForDate(MON, ctx());
  const kinds = new Set(timelineEvents(legs, ctx()).map((event) => event.kind));
  assert.deepEqual([...kinds], ["dep"]);
  const single = new Set(timelineEvents(legsForDate(MON, ctx({ routeChoice: "1049" })), ctx({ routeChoice: "1049" })).map((event) => event.kind));
  assert.ok(single.has("layover"), "ei ferje (1049) har framleis liggetid");
});
