// Samband 1049 Festøya–Hundeidvik (Fjord1/FRAM, M/F Dryna): data, kaier og at sambandet står for seg sjølv.
// Same mønster som 1136/1135: éi ferje, ei tabell frå Entur, eigne kaikoordinatar for AIS.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ALLOWED_MODES,
  CHOOSABLE_ROUTES,
  LINE_QUAYS,
  LIVE_VM_URLS,
  QUAY_COORDS,
  STOP_PLACES,
  activeMode,
  activePlan,
  cancellationQuery,
  chosenRoute,
  crossesArea,
  distanceMeters,
  fixAtQuay,
  fixFromAis,
  knownQuays,
  legsForDate,
  legsForMode,
  liveFetchUrls,
  nearLeg,
  otherFerryMode,
  signalPhone,
  tableName,
  vesselNameForTable,
} from "../../packages/core/index.js";

const ROUTES = JSON.parse(readFileSync(new URL("../../tests/fixtures/ruter.json", import.meta.url), "utf8"));
const MON = "2026-10-12";
const SAT = "2026-10-10";
const SUN = "2026-10-11";
const NOW = Date.UTC(2026, 9, 12, 8, 0);
const ctx = (extra = {}) => ({ routes: ROUTES, kombirute: null, messages: [], routeChoice: "1049", override: null, fromQuery: null, nowMs: NOW, today: MON, date: MON, ...extra });
const times = (date, from) => legsForMode("1049", date, ctx()).filter((leg) => leg.from === from).map((leg) => leg.departure.slice(0, 5)).sort();

test("1049: rutetabellen har Festøya↔Hundeidvik utan signalturar og med riktige dagar", () => {
  const line = ROUTES.lines["1049"];
  assert.equal(line.publicCode, "1049");
  assert.equal(line.lineId, "MOR:Line:1049");
  assert.ok(line.legs.length >= 40);
  assert.ok(line.legs.every((leg) => leg.signal == null && !leg.requestStop), "ingen signalturar i 1049");
  assert.ok(line.legs.every((leg) => new Set([leg.from, leg.to]).size === 2 && ["Festøya", "Hundeidvik"].includes(leg.from) && ["Festøya", "Hundeidvik"].includes(leg.to)));
  // Kvardag: 13 turar kvar veg. Laurdag og sundag er kortare.
  assert.deepEqual(times(MON, "Festøya"), ["06:20", "07:20", "08:30", "09:30", "10:30", "11:30", "13:30", "14:30", "15:30", "16:30", "17:30", "18:25", "19:05"]);
  assert.deepEqual(times(MON, "Hundeidvik"), ["06:00", "06:50", "08:00", "09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "18:45"]);
  assert.equal(times(SAT, "Hundeidvik")[0], "09:00");
  assert.equal(times(SUN, "Festøya")[0], "10:30");
  assert.equal(legsForMode("1049", "2026-12-25", ctx()).length, 0, "juledag utan rute");
  // Berre 1049-turar i 1049-tabellen, og dei andre sambanda får ikkje 1049-turar.
  assert.ok(legsForMode("1049", MON, ctx()).every((leg) => leg.table === "1049"));
  assert.ok(legsForMode("1136", MON, ctx()).every((leg) => !["Festøya", "Hundeidvik"].includes(leg.from)));
});

test("1049: valt samband gjev eigen tabell, òg når meldingane seier kombirute (meldingane styrer ikkje 1049)", () => {
  assert.ok(CHOOSABLE_ROUTES.has("1049") && ALLOWED_MODES.has("1049"));
  assert.equal(chosenRoute(ctx()), "1049");
  assert.equal(chosenRoute(ctx({ routeChoice: "1135" })), "1135");
  assert.equal(chosenRoute(ctx({ routeChoice: "9999" })), "1136");
  const kombiMsg = [
    { id: "k", heading: "Kombinasjonsrute", text: "Kombinert rute 1135 og 1136 frå klokka 10:00", publishedAt: "2026-10-12T05:00:00Z", validFrom: "2026-10-12T05:00:00Z", isLocal: true, isRouteControl: true, routeMode: "kombi", routeSwitch: null },
  ];
  const plan = activePlan(MON, ctx({ messages: kombiMsg }));
  assert.deepEqual(plan, { mode: "1049", switch: null, notice: null, uncertain: false });
  assert.equal(activeMode(ctx({ messages: kombiMsg })), "1049");
  assert.equal(activeMode(ctx({ routeChoice: "1136", override: "1049" })), "1049", "?rute=1049");
  const legs = legsForDate(MON, ctx({ messages: kombiMsg }));
  assert.equal(legs.length, 26);
  assert.ok(legs.every((leg) => leg.table === "1049"));
  assert.equal(tableName("1049"), "1049");
});

test("1049: ingen Hjørundfjord-logikk — ingen andre ferje, ingen overgang, ingen kombirute-telefon", () => {
  assert.equal(otherFerryMode(ctx()), null);
  assert.equal(crossesArea("Hundeidvik", "Festøya", ctx({ routes: { ...ROUTES, hjorundfjordQuays: ROUTES.hjorundfjordQuays } })), false);
  assert.equal(vesselNameForTable("1049", ctx()), null);
  assert.equal(signalPhone({ table: "1049" }, ctx()), "", "ikkje Kvernes-telefonen");
  assert.equal(signalPhone({ table: "1049", signal: { phone: "11 22 33 44" } }, ctx()), "11 22 33 44");
});

test("1049: kaier, stoppestader, Entur-adresse og AIS-kaikoordinatar", () => {
  for (const quay of ["Hundeidvik", "Festøya"]) {
    assert.ok(LINE_QUAYS.includes(quay) && knownQuays(ctx()).includes(quay));
    assert.match(STOP_PLACES[quay], /^NSR:StopPlace:\d+$/);
    assert.ok(QUAY_COORDS[quay].latitude > 62.3 && QUAY_COORDS[quay].longitude > 6.3);
  }
  assert.equal(STOP_PLACES.Hundeidvik, "NSR:StopPlace:58756");
  assert.equal(STOP_PLACES.Festøya, "NSR:StopPlace:38754");
  assert.deepEqual(liveFetchUrls("1049"), [LIVE_VM_URLS[1049]]);
  assert.match(LIVE_VM_URLS[1049], /LineRef=MOR:Line:1049$/);
  assert.match(cancellationQuery(["Hundeidvik"]), /MOR:Line:1049/);
  // ~4,8 km mellom kaiene (Entur: «4,8 km i luftline»).
  const span = distanceMeters(QUAY_COORDS.Festøya.latitude, QUAY_COORDS.Festøya.longitude, QUAY_COORDS.Hundeidvik.latitude, QUAY_COORDS.Hundeidvik.longitude);
  assert.ok(span > 4600 && span < 5000, `kaiavstand ${Math.round(span)} m`);
  // NAIS 10. okt. 2026 12:57: M/F Dryna ved Hundeidvik (62°22,3'N 6°25,4'E).
  const dryna = fixFromAis({ mmsi: 258408000, latitude: 62 + 22.3 / 60, longitude: 6 + 25.4 / 60, sog: 0, cog: 130, timestamp: NOW });
  assert.equal(fixAtQuay(dryna, "Hundeidvik"), true);
  assert.equal(fixAtQuay(dryna, "Festøya"), false);
  // Midt i fjorden er ikkje ved kai, men er på strekninga.
  const mid = fixFromAis({ mmsi: 258408000, latitude: 62.3733, longitude: 6.378, sog: 11, cog: 270, timestamp: NOW });
  const leg = { from: "Hundeidvik", to: "Festøya" };
  assert.equal(fixAtQuay(mid, "Hundeidvik") || fixAtQuay(mid, "Festøya"), false);
  assert.equal(nearLeg(mid, leg), true);
  // Ei Hjørundfjord-posisjon er ikkje på 1049-strekninga.
  assert.equal(nearLeg({ latitude: 62.2662, longitude: 6.4232 }, leg), false);
});
