// Reine funksjonar for overfarten (packages/core/crossing.js): framdrift, ved kai, alder,
// retning, berekna reserve og tekstane. Ligg under web/tests så CI køyrer dei med
// `npm test -w web` utan å endre test.yml.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { appVersion } from "../../tests/helpers/version.mjs";
import {
  AIS_MOORED_STALE_MS,
  FIX_FRESH_MS,
  FIX_PULSE_MS,
  FIX_STALE_MS,
  QUAY_COORDS,
  ariaPercent,
  countdownParts,
  crossingAnnouncement,
  crossingBadge,
  crossingFraction,
  crossingNote,
  crossingValueText,
  crossingView,
  fixAtQuay,
  fixFreshness,
  fixFromAis,
  fixFromLive,
  headingTowards,
  matchCrossingLeg,
  parseVehicleMonitoring,
  timetableFraction,
} from "../../packages/core/index.js";
// Same modulinstans som core (core importerer i18n med ?v=).
const { setLang } = await import(`../../assets/i18n.js?v=${appVersion()}`);

const repo = new URL("../../", import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, repo), "utf8"));
const ROUTES = json("tests/fixtures/ruter.json");
const VM_2030 = json("tests/fixtures/vm_2026-10-08_2030.json");

/** Oslo-veggtid 8. oktober 2026 (UTC+2) som epoke-ms. */
const oslo = (h, m, s = 0) => Date.UTC(2026, 9, 8, h - 2, m, s);
const S = QUAY_COORDS.Standal;
const T = QUAY_COORDS.Trandal;
/** Punkt `f` (0..1) på den rette linja Standal → Trandal. */
const along = (f) => ({
  latitude: S.latitude + (T.latitude - S.latitude) * f,
  longitude: S.longitude + (T.longitude - S.longitude) * f,
});
const leg = (from, to, departure, arrival, id = "") => ({ id, from, to, departure, arrival });
const OUT = leg("Standal", "Trandal", "20:00:00", "20:15:00", "MOR:ServiceJourney:1136_128_x#0");
const BACK = leg("Trandal", "Standal", "20:20:00", "20:35:00", "MOR:ServiceJourney:1136_129_x#0");
const ais = (f, at, extra = {}) => fixFromAis({ mmsi: 257297400, ...along(f), sog: 10, cog: 90, timestamp: at, ...extra });

test("framdrift: 0 ved startkai, 1 ved endekai, midt på ≈ 0,5", () => {
  assert.equal(crossingFraction(ais(0, oslo(20, 5)), "Standal", "Trandal"), 0);
  assert.ok(Math.abs(crossingFraction(ais(1, oslo(20, 5)), "Standal", "Trandal") - 1) < 1e-9);
  assert.ok(Math.abs(crossingFraction(ais(0.5, oslo(20, 5)), "Standal", "Trandal") - 0.5) < 0.01);
  // Same punkt, motsett retning.
  assert.ok(Math.abs(crossingFraction(ais(0.25, oslo(20, 5)), "Trandal", "Standal") - 0.75) < 0.01);
});

test("framdrift blir klemd til 0..1, også forbi kaia", () => {
  const past = ais(1.2, oslo(20, 5));
  const before = ais(-0.2, oslo(20, 5));
  for (const fix of [past, before]) {
    const value = crossingFraction(fix, "Standal", "Trandal");
    assert.ok(value >= 0 && value <= 1, String(value));
  }
  assert.equal(crossingFraction(ais(0.5, oslo(20, 5)), "Standal", "Ukjend kai"), null);
});

test("framdrifta går aldri bakover for same tur, men byrjar på nytt for ny tur", () => {
  const first = crossingView({ leg: OUT, fix: ais(0.6, oslo(20, 8)), nowMs: oslo(20, 8, 5) });
  assert.ok(first.progress > 0.55);
  // GPS-hopp bakover: ferja står der ho stod.
  const jitter = crossingView({ leg: OUT, fix: ais(0.4, oslo(20, 8, 20)), nowMs: oslo(20, 8, 25), previous: first });
  assert.equal(jitter.progress, first.progress);
  const later = crossingView({ leg: OUT, fix: ais(0.8, oslo(20, 9)), nowMs: oslo(20, 9, 5), previous: jitter });
  assert.ok(later.progress > first.progress);
  // Ny tur: førre framdrift gjeld ikkje.
  const next = crossingView({
    leg: BACK,
    fix: fixFromAis({ mmsi: 1, ...along(0.9), sog: 10, cog: 270, timestamp: oslo(20, 22) }),
    nowMs: oslo(20, 22, 5),
    previous: later,
  });
  assert.ok(next.progress < 0.2, String(next.progress));
});

test("målt posisjon avløyser anslaget frå rutetabellen, men ikkje omvendt", () => {
  const calc = crossingView({ leg: OUT, fix: null, nowMs: oslo(20, 9) });
  assert.ok(calc.progress > 0.55);
  const measured = crossingView({ leg: OUT, fix: ais(0.4, oslo(20, 8, 50)), nowMs: oslo(20, 9), previous: calc });
  assert.ok(Math.abs(measured.progress - 0.4) < 0.02, "målinga vinn over anslaget");
  // Målinga forsvinn: anslaget får ikkje flytte ferja bakover frå siste målte posisjon.
  const back = crossingView({ leg: OUT, fix: null, nowMs: oslo(20, 1), previous: measured });
  assert.equal(back.progress, measured.progress);
  // Ny måling litt bak den fyrste (GPS-støy): ferja står framleis der ho var.
  const jitter = crossingView({ leg: OUT, fix: ais(0.37, oslo(20, 9, 30)), nowMs: oslo(20, 9, 35), previous: back });
  assert.equal(jitter.progress, measured.progress);
});

test("ved kai: innanfor 250 m og under 0,5 kn", () => {
  const near = { ...along(0), latitude: S.latitude + 0.001 }; // ≈ 110 m
  const far = { ...along(0), latitude: S.latitude + 0.004 }; // ≈ 445 m
  const at = (pos, sog) => fixFromAis({ mmsi: 1, ...pos, sog, timestamp: oslo(20, 0) });
  assert.equal(fixAtQuay(at(near, 0.2), "Standal"), true);
  assert.equal(fixAtQuay(at(near, 3), "Standal"), false);
  assert.equal(fixAtQuay(at(far, 0), "Standal"), false);
  // Entur utan fart: VehicleAtStop false vinn over avstanden.
  const entur = { ...at(near, null), source: "entur", speedKn: null, atStop: false };
  assert.equal(fixAtQuay(entur, "Standal"), false);
  assert.equal(fixAtQuay({ ...entur, atStop: null }, "Standal"), true);
  // Ved endekai blir framdrifta 1, ved startkai 0.
  const arrived = crossingView({ leg: OUT, fix: fixFromAis({ mmsi: 1, ...along(1), sog: 0.1, timestamp: oslo(20, 14) }), nowMs: oslo(20, 14, 10) });
  assert.equal(arrived.progress, 1);
  assert.equal(arrived.atQuay, true);
});

test("alder: Live ≤ 60 s (puls ≤ 30 s), Siste kjende ≤ 5 min, så Ukjent", () => {
  const fix = ais(0.5, oslo(20, 5));
  const at = (ms) => fixFreshness(fix, fix.at + ms);
  assert.equal(at(0), "live");
  assert.equal(at(FIX_FRESH_MS), "live");
  assert.equal(at(FIX_FRESH_MS + 1), "stale");
  assert.equal(at(FIX_STALE_MS), "stale");
  assert.equal(at(FIX_STALE_MS + 1), "unknown");
  const view = (ms) => crossingView({ leg: OUT, fix, nowMs: fix.at + ms });
  assert.equal(view(FIX_PULSE_MS).pulse, true);
  assert.equal(view(FIX_PULSE_MS + 1000).pulse, false);
  assert.equal(view(FIX_PULSE_MS + 1000).state, "live");
  assert.equal(view(2 * 60 * 1000).state, "stale");
  assert.equal(view(6 * 60 * 1000).state, "unknown");
  assert.equal(view(6 * 60 * 1000).measured, true, "siste kjende posisjon er framleis målt, berre gammal");
});

test("AIS ved kai (fortøydd) har lengre grenser", () => {
  const moored = fixFromAis({ mmsi: 1, ...along(0), sog: 0, navStatus: 5, timestamp: oslo(20, 0) });
  assert.equal(fixFreshness(moored, moored.at + 3 * 60 * 1000), "live");
  assert.equal(fixFreshness(moored, moored.at + 10 * 60 * 1000), "stale");
  assert.equal(fixFreshness(moored, moored.at + AIS_MOORED_STALE_MS + 1), "unknown");
  // Entur får ikkje dei lengre grensene.
  const entur = { ...moored, source: "entur", moored: false, speedKn: null };
  assert.equal(fixFreshness(entur, entur.at + 3 * 60 * 1000), "stale");
});

test("retning: kurs eller krympande avstand avgjer kva tur posisjonen høyrer til", () => {
  const legs = [leg("Standal", "Trandal", "20:00:00", "20:15:00"), leg("Trandal", "Standal", "20:05:00", "20:20:00")];
  const east = ais(0.5, oslo(20, 7), { cog: 95 });
  const west = ais(0.5, oslo(20, 7), { cog: 265 });
  assert.equal(headingTowards(east, "Standal", "Trandal"), true);
  assert.equal(headingTowards(west, "Standal", "Trandal"), false);
  assert.equal(matchCrossingLeg(legs, east).to, "Trandal");
  assert.equal(matchCrossingLeg(legs, west).to, "Standal");
  // Utan kurs: førre posisjon. Nærare Standal no enn før = mot Standal.
  const noCourse = (f, at) => fixFromAis({ mmsi: 1, ...along(f), timestamp: at });
  const before = noCourse(0.6, oslo(20, 6));
  const now = noCourse(0.5, oslo(20, 7));
  assert.equal(headingTowards(now, "Standal", "Trandal", before), false);
  assert.equal(matchCrossingLeg(legs, now, { previous: before }).to, "Standal");
  // Utan retning: nærmaste planlagde avgang.
  assert.equal(matchCrossingLeg(legs, now).departure, "20:05:00");
});

test("ingen posisjon: berekna frå rutetabellen, aldri merkt som målt", () => {
  const view = crossingView({ leg: OUT, fix: null, nowMs: oslo(20, 6) });
  assert.equal(view.state, "calc");
  assert.equal(view.source, "computed");
  assert.equal(view.measured, false);
  assert.ok(Math.abs(view.progress - 0.4) < 1e-9);
  assert.equal(timetableFraction(OUT, oslo(19, 50)), 0);
  assert.equal(timetableFraction(OUT, oslo(20, 30)), 1);
  // Ein posisjon frå før avgangen (ferja låg ved kai førre tur) høyrer ikkje til denne overfarten.
  const old = ais(0.5, oslo(19, 40));
  assert.equal(crossingView({ leg: OUT, fix: old, nowMs: oslo(20, 6) }).state, "calc");
  // Posisjon på ein annan stad i fjorden (Sæbø) er heller ikkje denne turen.
  const elsewhere = fixFromAis({ mmsi: 1, ...QUAY_COORDS.Sæbø, timestamp: oslo(20, 6) });
  assert.equal(crossingView({ leg: OUT, fix: elsewhere, nowMs: oslo(20, 6) }).state, "calc");
});

test("nyaste posisjon som høyrer til turen vinn; AIS ved likt", () => {
  const entur = { ...ais(0.3, oslo(20, 5)), source: "entur", speedKn: null, course: null };
  const aisFix = ais(0.4, oslo(20, 5));
  assert.equal(crossingView({ leg: OUT, fixes: [entur, aisFix], nowMs: oslo(20, 5, 10) }).source, "ais");
  const newer = { ...entur, at: oslo(20, 5, 30) };
  assert.equal(crossingView({ leg: OUT, fixes: [aisFix, newer], nowMs: oslo(20, 5, 40) }).source, "entur");
});

test("crossing.js les ikkje tripStatus: posisjonen er aldri bevis for at ein tur gjekk", () => {
  const source = readFileSync(new URL("packages/core/crossing.js", repo), "utf8");
  assert.doesNotMatch(source, /from "\.\/(tripstatus|status|signal)\.js/);
  assert.doesNotMatch(source, /(liveProvesSailed|signalVerdict|tripStatus)\(/);
  const view = crossingView({ leg: OUT, fix: null, nowMs: oslo(20, 6) });
  assert.deepEqual(
    Object.keys(view).sort(),
    ["ageMs", "arrival", "atQuay", "departure", "fixAt", "from", "lastMeasured", "measured", "percent", "progress", "pulse", "source", "state", "to", "trip"]
  );
});

test("tekstar: merke, kjeldeline og aria-valuetext seier alltid kjelda (nn)", () => {
  setLang("nn");
  const fix = ais(0.32, oslo(20, 5));
  const live = crossingView({ leg: OUT, fix, nowMs: fix.at + 12000 });
  assert.equal(crossingBadge(live), "Live · AIS · 12 s");
  assert.equal(crossingNote(live), "Posisjon målt med AIS frå Kystverket.");
  assert.match(crossingValueText(live), /^3[05] % av overfarten frå Standal til Trandal, målt med AIS$/);
  const stale = crossingView({ leg: OUT, fix, nowMs: fix.at + 3 * 60000 });
  assert.equal(crossingBadge(stale), "Siste kjende · 3 min sidan");
  assert.match(crossingValueText(stale), /siste kjende posisjon$/);
  const unknown = crossingView({ leg: OUT, fix, nowMs: fix.at + 7 * 60000 });
  assert.equal(crossingBadge(unknown), "Ukjent · ingen sanntid sidan 20:05");
  assert.match(crossingValueText(unknown), /posisjon ukjend$/);
  const calc = crossingView({ leg: OUT, fix: null, nowMs: oslo(20, 6) });
  assert.equal(crossingBadge(calc), "Berekna · rutetabell");
  assert.match(crossingValueText(calc), /^40 % av overfarten frå Standal til Trandal, berekna frå rutetabellen$/);
  const entur = crossingView({ leg: OUT, fix: { ...fix, source: "entur" }, nowMs: fix.at + 5000 });
  assert.equal(crossingBadge(entur), "Live · Entur · 5 s");
  setLang("en");
  assert.equal(crossingBadge(calc), "Estimated · timetable");
  setLang("de");
  assert.equal(crossingBadge(stale), "Zuletzt bekannt · vor 3 Min.");
  setLang("nn");
});

test("aria-valuenow runda til 5 %", () => {
  assert.equal(ariaPercent(0.32), 30);
  assert.equal(ariaPercent(0.33), 35);
  assert.equal(ariaPercent(1.4), 100);
});

test("live-regionen: berre ved skifte av tilstand eller kjelde, ikkje ved ny posisjon", () => {
  setLang("nn");
  const a = crossingView({ leg: OUT, fix: ais(0.3, oslo(20, 5)), nowMs: oslo(20, 5, 5) });
  const b = crossingView({ leg: OUT, fix: ais(0.4, oslo(20, 5, 30)), nowMs: oslo(20, 5, 35), previous: a });
  assert.equal(crossingAnnouncement(a, b), "");
  const calc = { ...b, state: "calc", source: "computed" };
  assert.equal(crossingAnnouncement(b, calc), "Sanntidsposisjon manglar. Posisjonen er no berekna frå rutetabellen.");
  assert.equal(crossingAnnouncement(calc, b), "Sanntidsposisjonen er tilbake.");
  assert.equal(crossingAnnouncement(null, b), "", "ingenting ved fyrste teikning");
});

test("nedteljing: t + 0-fylte min over 60 min, min frå 10, m:ss under 10", () => {
  setLang("nn");
  const now = oslo(19, 0);
  assert.equal(countdownParts("20:05:00", now).text, "Neste avgang om 1 t 05 min");
  assert.equal(countdownParts("19:23:00", now).text, "Neste avgang om 23 min");
  const close = countdownParts("19:04:05", now);
  assert.equal(close.text, "Neste avgang om 4:05");
  assert.equal(close.tabular, true);
  assert.equal(close.sr, "Neste avgang om 5 minutt");
  // Skjermlesarteksten endrar seg berre ved minuttskifte.
  assert.equal(countdownParts("19:04:05", now + 4000).sr, close.sr);
  assert.equal(countdownParts("19:00:00", now).text, "Neste avgang no");
  setLang("en");
  assert.equal(countdownParts("20:05:00", now).text, "Next departure in 1 h 05 min");
  setLang("nn");
});

test("avspeling: ekte VM frå Entur 8. okt. kl. 20:30 (ved kai på Standal)", () => {
  const live = parseVehicleMonitoring(VM_2030);
  const fix = fixFromLive(live);
  assert.equal(fix.source, "entur");
  assert.equal(fix.journeyRef, "MOR:ServiceJourney:1136_129_9150000046366348");
  const legs = ROUTES.lines["1136"].legs.filter((item) => item.activeDates.includes("2026-10-08"));
  const hit = matchCrossingLeg(legs, fix);
  assert.equal(`${hit.from}→${hit.to} ${hit.departure}`, "Trandal→Standal 20:20:00");
  const view = crossingView({ leg: hit, fix, nowMs: fix.at + 12000 });
  assert.equal(view.state, "live");
  assert.equal(view.atQuay, true);
  assert.equal(view.progress, 1);
  // Det same svaret 7 min seinare er ukjent, ikkje «live».
  assert.equal(crossingView({ leg: hit, fix, nowMs: fix.at + 7 * 60000 }).state, "unknown");
});

test("avspeling: VM-meldingar langs Trandal → Standal (laga av den ekte meldinga)", () => {
  // Same SIRI-form som Entur-svaret over, med posisjonen flytta langs strekninga kvart 20. s.
  // Syntetisk: Entur sende ikkje så tette posisjonar for 1136 den dagen.
  const legs = ROUTES.lines["1136"].legs.filter((item) => item.activeDates.includes("2026-10-08"));
  const steps = [0, 0.05, 0.2, 0.35, 0.33, 0.5, 0.7, 0.9, 1];
  let previous = null;
  const seen = [];
  steps.forEach((f, i) => {
    const message = structuredClone(VM_2030);
    const activity = message.Siri.ServiceDelivery.VehicleMonitoringDelivery[0].VehicleActivity[0];
    const at = new Date(oslo(20, 21) + i * 20000);
    activity.RecordedAtTime = at.toISOString();
    activity.ValidUntilTime = new Date(at.getTime() + 120000).toISOString();
    const pos = along(1 - f); // Trandal (f=0) → Standal (f=1)
    activity.MonitoredVehicleJourney.VehicleLocation = { Latitude: pos.latitude, Longitude: pos.longitude };
    activity.MonitoredVehicleJourney.MonitoredCall.VehicleAtStop = f === 1;
    const fix = fixFromLive(parseVehicleMonitoring(message));
    const hit = matchCrossingLeg(legs, fix);
    assert.equal(hit.departure, "20:20:00");
    previous = crossingView({ leg: hit, fix, nowMs: fix.at + 3000, previous });
    seen.push(previous.progress);
    assert.equal(previous.state, "live");
  });
  for (let i = 1; i < seen.length; i += 1) assert.ok(seen[i] >= seen[i - 1], `bakover ved steg ${i}: ${seen}`);
  assert.equal(seen.at(-1), 1);
});
