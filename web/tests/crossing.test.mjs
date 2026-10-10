// Reine funksjonar for overfarten (packages/core/crossing.js): framdrift, ved kai, alder,
// retning, berekna reserve og tekstane. Ligg under web/tests så CI køyrer dei med
// `npm test -w web` utan å endre test.yml.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { appVersion } from "../../tests/helpers/version.mjs";
import {
  AIS_MOORED_STALE_MS,
  bestFix,
  positionNoteKey,
  statusFromPosition,
  outsideFix,
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
  crossingProgressText,
  positionSourceView,
  aisSpeed,
  crossingValueText,
  crossingView,
  fixAtQuay,
  fixBelongsTo,
  fixFreshness,
  fixFromAis,
  fixFromLive,
  headingTowards,
  matchCrossingLeg,
  parseVehicleMonitoring,
  timetableFraction,
} from "../../packages/core/index.js";
// Same modulinstans som core (core importerer i18n med ?v=).
const { setLang, t } = await import(`../../assets/i18n.js?v=${appVersion()}`);

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
/** Kurs (grader) frå ei kai mot ei anna. */
const headingTo = (a, b) => {
  const rad = (deg) => (deg * Math.PI) / 180;
  const y = Math.sin(rad(b.longitude - a.longitude)) * Math.cos(rad(b.latitude));
  const x = Math.cos(rad(a.latitude)) * Math.sin(rad(b.latitude)) - Math.sin(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(rad(b.longitude - a.longitude));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};
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
  // Eldre enn 5 min er ikkje lenger ein måling: rutetabellen gjeld, aldri ved kai.
  assert.equal(view(6 * 60 * 1000).measured, false);
  assert.equal(view(6 * 60 * 1000).source, "computed");
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

test("prioritet AIS > Entur > rutetabell: ein fersk AIS-posisjon vinn, òg mot ein nyare Entur-posisjon", () => {
  const entur = { ...ais(0.3, oslo(20, 5)), source: "entur", speedKn: null, course: null };
  const aisFix = ais(0.4, oslo(20, 5));
  assert.equal(crossingView({ leg: OUT, fixes: [entur, aisFix], nowMs: oslo(20, 5, 10) }).source, "ais");
  assert.equal(crossingView({ leg: OUT, fixes: [aisFix, entur], nowMs: oslo(20, 5, 10) }).source, "ais");
  const newer = { ...entur, at: oslo(20, 5, 30) };
  const both = crossingView({ leg: OUT, fixes: [aisFix, newer], nowMs: oslo(20, 5, 40) });
  assert.equal(both.source, "ais", "AIS (35 s) er live og går føre Entur (10 s)");
  assert.ok(Math.abs(both.progress - 0.4) < 0.02, "framdrifta kjem frå AIS-posisjonen");
  // AIS blir for gammal (siste kjende), Entur er live: då veit vi meir frå Entur.
  const staleAis = crossingView({ leg: OUT, fixes: [aisFix, { ...entur, at: oslo(20, 6, 20) }], nowMs: oslo(20, 6, 30) });
  assert.equal(staleAis.source, "entur");
  assert.equal(staleAis.state, "live");
  // Berre AIS, berre Entur, ingen: kjelda følgjer det vi faktisk har, elles rutetabellen.
  assert.equal(crossingView({ leg: OUT, fixes: [aisFix], nowMs: oslo(20, 5, 10) }).source, "ais");
  assert.equal(crossingView({ leg: OUT, fixes: [entur], nowMs: oslo(20, 5, 10) }).source, "entur");
  const none = crossingView({ leg: OUT, fixes: [], nowMs: oslo(20, 5, 10) });
  assert.deepEqual([none.source, none.state, none.measured], ["computed", "calc", false]);
});

test("bestFix: ferskleik, så kjelde, så nyaste; computed og tomt blir hoppa over", () => {
  const e = (f, at) => ({ ...ais(f, at), source: "entur", speedKn: null, course: null });
  const a = (f, at) => ais(f, at);
  const now = oslo(20, 10);
  assert.equal(bestFix([], now), null);
  assert.equal(bestFix(null, now), null);
  assert.equal(bestFix([null, { source: "computed", at: now }], now), null);
  assert.equal(bestFix([e(0.5, now - 5000), a(0.5, now - 50000)], now).source, "ais", "begge live: AIS");
  assert.equal(bestFix([a(0.5, now - 120000), e(0.5, now - 10000)], now).source, "entur", "AIS siste kjende, Entur live");
  assert.equal(bestFix([a(0.5, now - 200000), e(0.5, now - 100000)], now).source, "ais", "begge siste kjende: AIS");
  assert.equal(bestFix([a(0.5, now - 900000), e(0.5, now - 600000)], now).source, "entur", "begge ukjende: den nyaste");
  // AIS ved kai har lengre grenser: 3 min gammal og framleis live, så ho går føre Entur.
  const quay = ais(0, now - 180000, { sog: 0 });
  assert.equal(fixFreshness(quay, now), "live");
  assert.equal(bestFix([e(0, now - 5000), quay], now).source, "ais");
});

test("fixFromAis: manglande fart og kurs er ukjend, ikkje 0 (0 kn ville sagt «ved kai»)", () => {
  const fix = fixFromAis({ mmsi: 1, ...along(0.5), sog: null, cog: null, navStatus: null, timestamp: oslo(20, 5) });
  assert.equal(fix.speedKn, null);
  assert.equal(fix.course, null);
  assert.equal(fix.moored, false);
  assert.equal(fixFromAis({ mmsi: 1, ...along(0.5), sog: "", timestamp: oslo(20, 5) }).speedKn, null);
  assert.equal(fixFromAis({ mmsi: 1, ...along(0.5), sog: 0, timestamp: oslo(20, 5) }).speedKn, 0);
});

test("ingen tekst seier «Entur» når posisjonen er AIS, og ingen seier «AIS» når han er Entur (nn, en, de)", () => {
  const fix = ais(0.32, oslo(20, 5));
  const entur = { ...fix, source: "entur" };
  for (const lang of ["nn", "en", "de"]) {
    setLang(lang);
    for (const [label, ageMs] of [["live", 12000], ["stale", 3 * 60000]]) {
      const view = crossingView({ leg: OUT, fix, nowMs: fix.at + ageMs });
      const texts = [crossingBadge(view), crossingNote(view), crossingValueText(view)];
      for (const text of texts) {
        assert.match(text, /\bAIS\b|Kystverket|siste kjende posisjon|letzte bekannte|last known/i, `${lang} ${label}: ${text}`);
        assert.doesNotMatch(text, /Entur/, `${lang} ${label}: ${text}`);
      }
      assert.match(crossingBadge(view), /AIS/, `${lang} ${label} merke`);
      assert.match(crossingValueText(view), /AIS/, `${lang} ${label} aria`);
      const ev = crossingView({ leg: OUT, fix: entur, nowMs: fix.at + ageMs });
      for (const text of [crossingBadge(ev), crossingNote(ev), crossingValueText(ev)]) {
        assert.doesNotMatch(text, /AIS/, `${lang} ${label} (Entur): ${text}`);
      }
      assert.match(crossingBadge(ev), /Entur/);
      assert.match(crossingValueText(ev), /Entur/);
    }
    // Ukjent og berekna nemner ingen kjelde som ikkje finst.
    const unknown = crossingView({ leg: OUT, fix, nowMs: fix.at + 7 * 60000 });
    const calc = crossingView({ leg: OUT, fix: null, nowMs: oslo(20, 6) });
    for (const view of [unknown, calc]) {
      for (const text of [crossingBadge(view), crossingNote(view), crossingValueText(view)]) assert.doesNotMatch(text, /AIS|Entur/, `${lang}: ${text}`);
    }
  }
  setLang("nn");
  assert.equal(crossingBadge(crossingView({ leg: OUT, fix, nowMs: fix.at + 12000 })), "Live frå AIS · 12 s");
  assert.equal(crossingBadge(crossingView({ leg: OUT, fix: entur, nowMs: fix.at + 12000 })), "Live frå Entur · 12 s");
  setLang("en");
  assert.equal(crossingBadge(crossingView({ leg: OUT, fix, nowMs: fix.at + 12000 })), "Live from AIS · 12 s");
  assert.equal(crossingBadge(crossingView({ leg: OUT, fix: entur, nowMs: fix.at + 3 * 60000 })), "Last known from Entur · 3 min ago");
  setLang("de");
  assert.equal(crossingBadge(crossingView({ leg: OUT, fix, nowMs: fix.at + 12000 })), "Live von AIS · 12 s");
  setLang("nn");
});

test("fotnoten om posisjon nemner berre kjelda posisjonen kjem frå", () => {
  const now = oslo(20, 5, 30);
  const a = ais(0.3, oslo(20, 5, 10));
  const e = { ...ais(0.3, oslo(20, 5, 25)), source: "entur" };
  assert.equal(positionNoteKey(null, false, [], [e, a], now), "position.liveAis");
  assert.equal(positionNoteKey(null, false, [], [e], now), "position.live");
  assert.equal(positionNoteKey(null, false, [], [], now), "position.plannedAny");
  assert.equal(positionNoteKey(null, true, [], [], now), "position.offline");
  // AIS er gammal og Entur live: Entur er kjelda no.
  assert.equal(positionNoteKey(null, false, [], [ais(0.3, oslo(20, 4)), e], now), "position.live");
  // Utan fixes (vanilla): som før.
  assert.equal(positionNoteKey(null, false, []), "position.planned");
  for (const lang of ["nn", "en", "de"]) {
    setLang(lang);
    assert.doesNotMatch(t("position.liveAis"), /Entur/, lang);
    assert.match(t("position.liveAis"), /AIS/, lang);
    assert.doesNotMatch(t("position.live"), /AIS/, lang);
  }
  setLang("nn");
});

test("crossing.js les ikkje tripStatus: posisjonen er aldri bevis for at ein tur gjekk", () => {
  const source = readFileSync(new URL("packages/core/crossing.js", repo), "utf8");
  assert.doesNotMatch(source, /from "\.\/(tripstatus|status|signal)\.js/);
  assert.doesNotMatch(source, /(liveProvesSailed|signalVerdict|tripStatus)\(/);
  const view = crossingView({ leg: OUT, fix: null, nowMs: oslo(20, 6) });
  assert.deepEqual(
    Object.keys(view).sort(),
    ["ageMs", "arrival", "atQuay", "departure", "fixAt", "from", "lastEstimate", "lastMeasured", "left", "measured", "percent", "progress", "pulse", "seenLive", "source", "speedKn", "state", "to", "trip"]
  );
});

test("tekstar: merke, kjeldeline og aria-valuetext seier alltid kjelda (nn)", () => {
  setLang("nn");
  const fix = ais(0.32, oslo(20, 5));
  const live = crossingView({ leg: OUT, fix, nowMs: fix.at + 12000 });
  assert.equal(crossingBadge(live), "Live frå AIS · 12 s");
  assert.equal(crossingNote(live), "Posisjon målt med AIS frå Kystverket.");
  assert.match(crossingValueText(live), /^3[05] % av overfarten frå Standal til Trandal, målt med AIS, 10 knop$/);
  const stale = crossingView({ leg: OUT, fix, nowMs: fix.at + 3 * 60000 });
  assert.equal(crossingBadge(stale), "Siste kjende frå AIS · 3 min sidan");
  assert.match(crossingValueText(stale), /siste kjende posisjon, frå AIS, 10 knop$/);
  const unknown = crossingView({ leg: OUT, fix, nowMs: fix.at + 7 * 60000 });
  assert.equal(crossingBadge(unknown), "Ukjent · ingen sanntid sidan 20:05");
  assert.match(crossingValueText(unknown), /posisjon ukjend, berekna frå rutetabellen$/);
  assert.equal(crossingProgressText(unknown), `ca. ${unknown.percent} % av overfarten · planlagt framme 20:15 · om 3 min`);
  assert.equal(crossingProgressText(live), `${live.percent} % av overfarten · Framme 20:15 · om 9 min`);
  assert.equal(live.left, 9, "minutt att, rundt ned");
  const calc = crossingView({ leg: OUT, fix: null, nowMs: oslo(20, 6) });
  assert.equal(crossingBadge(calc), "Berekna frå rutetabellen");
  assert.match(crossingValueText(calc), /^40 % av overfarten frå Standal til Trandal, berekna frå rutetabellen$/);
  const entur = crossingView({ leg: OUT, fix: { ...fix, source: "entur" }, nowMs: fix.at + 5000 });
  assert.equal(crossingBadge(entur), "Live frå Entur · 5 s");
  setLang("en");
  assert.equal(crossingBadge(calc), "Estimated from the timetable");
  assert.match(crossingProgressText(calc), /^about 40 % of the crossing · scheduled arrival 20:15 · in 9 min$/);
  setLang("de");
  assert.equal(crossingBadge(stale), "Zuletzt bekannt von AIS · vor 3 Min.");
  setLang("nn");
});

test("aria-valuenow runda til 5 %", () => {
  assert.equal(ariaPercent(0.32), 30);
  assert.equal(ariaPercent(0.33), 35);
  assert.equal(ariaPercent(1.4), 100);
});

test("live-regionen: til ukjent/berekna berre etter live, tilbake til live berre etter ukjent", () => {
  setLang("nn");
  const fix = ais(0.3, oslo(20, 5));
  const live = crossingView({ leg: OUT, fix, nowMs: oslo(20, 5, 5) });
  const moved = crossingView({ leg: OUT, fix: ais(0.4, oslo(20, 5, 30)), nowMs: oslo(20, 5, 35), previous: live });
  assert.equal(crossingAnnouncement(live, moved), "", "ny posisjon: ingenting");
  const stale = crossingView({ leg: OUT, fix: ais(0.4, oslo(20, 5, 30)), nowMs: oslo(20, 7, 30), previous: moved });
  assert.equal(stale.state, "stale");
  assert.equal(crossingAnnouncement(moved, stale), "", "live → siste kjende: ingenting");
  const unknown = crossingView({ leg: OUT, fix: ais(0.4, oslo(20, 5, 30)), nowMs: oslo(20, 11), previous: stale });
  assert.equal(crossingAnnouncement(stale, unknown), "Vi veit ikkje kvar ferja er no.", "etter live (via siste kjende)");
  const back = crossingView({ leg: OUT, fix: ais(0.8, oslo(20, 11, 10)), nowMs: oslo(20, 11, 15), previous: unknown });
  assert.equal(crossingAnnouncement(unknown, back), "Sanntidsposisjonen er tilbake.");
  assert.equal(crossingAnnouncement(stale, { ...moved, trip: stale.trip }), "", "siste kjende → live: ingenting");
  const calc = crossingView({ leg: OUT, fix: null, nowMs: oslo(20, 11, 30), previous: back });
  assert.equal(crossingAnnouncement(back, calc), "Sanntidsposisjon manglar. Posisjonen er no berekna frå rutetabellen.");
  assert.equal(crossingAnnouncement(calc, crossingView({ leg: OUT, fix: ais(0.9, oslo(20, 12)), nowMs: oslo(20, 12, 5), previous: calc })), "", "berekna → live: ingenting");
  // Aldri hatt live: ingenting.
  const neverLive = crossingView({ leg: OUT, fix: null, nowMs: oslo(20, 6) });
  assert.equal(crossingAnnouncement(neverLive, { ...neverLive, state: "unknown" }), "");
  assert.equal(crossingAnnouncement(null, live), "", "ingenting ved fyrste teikning");
});

test("Reviewer: posisjon med same journeyRef frå i går eller før avgang høyrer ikkje til turen", () => {
  const ref = "MOR:ServiceJourney:1136_128_x";
  const legs = [OUT, BACK];
  const at = (ms, f = 0.5) => ({ ...ais(f, ms), source: "entur", speedKn: null, course: null, journeyRef: ref });
  const yesterday = at(oslo(20, 5) - 24 * 3600 * 1000);
  const early = at(oslo(17, 55));
  for (const fix of [yesterday, early]) {
    assert.equal(matchCrossingLeg(legs, fix, { nowMs: oslo(20, 10) }), null);
    const view = crossingView({ leg: OUT, fix, nowMs: oslo(20, 10) });
    assert.equal(view.state, "calc");
    assert.equal(view.measured, false);
    assert.ok(Math.abs(view.progress - 10 / 15) < 1e-9, "rutetabellen, ikkje den gamle posisjonen");
  }
  assert.equal(matchCrossingLeg(legs, at(oslo(20, 5)), { nowMs: oslo(20, 10) }).departure, "20:00:00");
});

test("Reviewer: gammal posisjon ved endekaia gjev ikkje «ved kai» eller 100 %", () => {
  // 40 min gammal posisjon ved Trandal for 20:00-turen, no 20:10 (ferja midt på fjorden etter rutetabellen).
  const old = { ...fixFromAis({ mmsi: 1, ...along(1), sog: 0, timestamp: oslo(19, 59) }) };
  const view = crossingView({ leg: OUT, fix: old, nowMs: oslo(20, 39) });
  assert.equal(view.atQuay, false);
  assert.equal(view.measured, false);
  // Målt 20:11 ved Trandal (ankomst 20:15), men 19 min gammal ved 20:30: ukjend.
  const fresh = fixFromAis({ mmsi: 1, ...along(1), sog: 0, timestamp: oslo(20, 11) });
  const unknownAtQuay = crossingView({ leg: OUT, fix: fresh, nowMs: oslo(20, 30) });
  assert.equal(unknownAtQuay.state, "unknown");
  assert.equal(unknownAtQuay.atQuay, false);
  assert.equal(unknownAtQuay.source, "computed");
  // Entur (ikkje AIS) ved kai, 2 min gammal: siste kjende, men ikkje «ved kai».
  const enturStale = { ...fresh, source: "entur", speedKn: null, at: oslo(20, 8) };
  const stale = crossingView({ leg: OUT, fix: enturStale, nowMs: oslo(20, 10) });
  assert.equal(stale.state, "stale");
  assert.equal(stale.atQuay, false);
  // AIS ved kai, 2 min gammal: AIS sender sjeldnare ved kai, så det gjeld. (Ferja har rekt fram: ankomst 20:15, målt 20:11.)
  assert.equal(crossingView({ leg: OUT, fix: { ...fresh, at: oslo(20, 11) }, nowMs: oslo(20, 13) }).atQuay, true);
});

test("Reviewer: ein posisjon som vart for gammal, held ikkje anslaget oppe", () => {
  const fix = fixFromAis({ mmsi: 1, ...along(0.95), sog: 10, cog: 90, timestamp: oslo(20, 2) });
  const live = crossingView({ leg: OUT, fix, nowMs: oslo(20, 2, 10) });
  assert.ok(live.progress > 0.9);
  const unknown = crossingView({ leg: OUT, fix, nowMs: oslo(20, 9), previous: live });
  assert.equal(unknown.state, "unknown");
  assert.ok(Math.abs(unknown.progress - 9 / 15) < 1e-9, "rutetabellen, ikkje 95 %");
  const later = crossingView({ leg: OUT, fix: null, nowMs: oslo(20, 10), previous: unknown });
  assert.ok(Math.abs(later.progress - 10 / 15) < 1e-9);
  // Og ei ny, ekte måling kan dra ho ned att til der ferja faktisk er.
  const real = crossingView({ leg: OUT, fix: ais(0.5, oslo(20, 10, 30)), nowMs: oslo(20, 10, 35), previous: later });
  assert.ok(Math.abs(real.progress - 0.5) < 0.02, String(real.progress));
});

test("kjeldemerket utan overfart: live, siste kjende, ukjent eller berekna", () => {
  setLang("nn");
  const fix = { ...ais(0, oslo(20, 0)), source: "entur" };
  assert.equal(crossingBadge(positionSourceView([fix], oslo(20, 0, 12))), "Live frå Entur · 12 s");
  assert.equal(crossingBadge(positionSourceView([fix], oslo(20, 2))), "Siste kjende frå Entur · 2 min sidan");
  const old = positionSourceView([fix], oslo(20, 7));
  assert.equal(crossingBadge(old), "Ukjent · ingen sanntid sidan 20:00");
  assert.equal(old.measured, false);
  assert.equal(crossingBadge(positionSourceView([], oslo(20, 7))), "Berekna frå rutetabellen");
});

test("nedteljing: t + 0-fylte min over 60 min, min frå 10, m:ss under 10", () => {
  setLang("nn");
  const now = oslo(19, 0);
  assert.equal(countdownParts("19:04:05", now).phrase, "om 4:05");
  assert.equal(countdownParts("19:04:05", now).srPhrase, "om 5 min");
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

test("statuslinja etter posisjon: AIS ved kai gjer «på veg» til «ligg til kai»; uendra når dei er samde", () => {
  setLang("nn");
  const underway = { at: 20 * 60 + 0.5, underway: true, text: "Ferja er på veg mot Trandal" };
  const ctx = { running: [OUT], quays: ["Standal", "Trandal"], now: 20 * 60 + 14 };
  const nowMs = oslo(20, 14, 30);
  // AIS: ved Trandal-kaia, 0 kn, 20 s gammal → ferja er framme (rutetabellen sa «på veg»).
  const atQuay = statusFromPosition(underway, { ...ctx, fixes: [ais(1, nowMs - 20000, { sog: 0 })], nowMs });
  assert.equal(atQuay.short, "Ferja ligg til kai på Trandal");
  assert.equal(atQuay.text, "Ferja ligg til kai på Trandal.");
  assert.equal(atQuay.underway, undefined);
  assert.equal(atQuay.position, "ais");
  // AIS i fart midt på fjorden: same syn som rutetabellen, objektet blir ikkje rørt.
  assert.equal(statusFromPosition(underway, { ...ctx, fixes: [ais(0.5, nowMs - 20000)], nowMs }), underway);
  // Ikkje AIS (Entur-posisjon ved kai): Entur gjev alt bevis gjennom currentStatus, ikkje rørt her.
  const enturAtQuay = { ...ais(1, nowMs - 5000, { sog: 0 }), source: "entur" };
  assert.equal(statusFromPosition(underway, { ...ctx, fixes: [enturAtQuay], nowMs }), underway);
  // Utan posisjonar: uendra.
  assert.equal(statusFromPosition(underway, { ...ctx, fixes: [], nowMs }), underway);
});

test("statuslinja ved kai-AIS: grensene følgjer fixFreshness (ved kai live 4 min, så siste kjende)", () => {
  setLang("nn");
  const underway = { at: 1200.5, underway: true, text: "Ferja er på veg mot Trandal" };
  const ctx = { running: [OUT], quays: ["Standal", "Trandal"], now: 20 * 60 + 14 };
  const nowMs = oslo(20, 14, 30);
  const fresh = ais(1, nowMs - 3 * 60000, { sog: 0 });
  assert.equal(fixFreshness(fresh, nowMs), "live");
  assert.equal(statusFromPosition(underway, { ...ctx, fixes: [fresh], nowMs }).short, "Ferja ligg til kai på Trandal");
  const stale = ais(1, nowMs - 6 * 60000, { sog: 0 });
  assert.equal(fixFreshness(stale, nowMs), "stale");
  assert.equal(statusFromPosition(underway, { ...ctx, fixes: [stale], nowMs }), underway, "berre fersk AIS rettar statusen");
});

test("statuslinja: ferja ikkje avgått (AIS ved startkaia) – raden «No» ligg føre avgangen; i fart når rutetabellen sa kai", () => {
  setLang("nn");
  const underway = { at: 1200.5, underway: true, text: "Ferja er på veg mot Trandal" };
  const nowMs = oslo(20, 2);
  const stuck = statusFromPosition(underway, { running: [OUT], quays: ["Standal", "Trandal"], now: 20 * 60 + 2, fixes: [ais(0, nowMs - 10000, { sog: 0 })], nowMs });
  assert.equal(stuck.short, "Ferja ligg til kai på Standal");
  assert.equal(stuck.at, 20 * 60 - 0.5, "føre avgangen 20:00");
  // Rutetabellen seier ved kai (liggetid), AIS viser ferja i fart på turen 20:20 Trandal → Standal.
  const moored = { at: 1215.5, text: "Ferja ligg til kai på Trandal" };
  const t2 = oslo(20, 22);
  const moving = statusFromPosition(moored, { running: [BACK], quays: ["Standal", "Trandal"], now: 20 * 60 + 22, fixes: [ais(0.4, t2 - 10000, { sog: 11, cog: 270 })], nowMs: t2 });
  assert.equal(moving.text, "Ferja er på veg mot Standal");
  assert.equal(moving.underway, true);
  // Langsamt i fjorden utan å vere ved ei kai: ikkje påstå noko nytt.
  assert.equal(statusFromPosition(moored, { running: [BACK], quays: ["Standal", "Trandal"], now: 20 * 60 + 22, fixes: [ais(0.4, t2 - 10000, { sog: 0.2 })], nowMs: t2 }), moored);
  // Signalturar, avlyste og tomme statusar blir ikkje rørte (berre atQuay kjem til: kvar AIS viser ferja).
  const signal = { ...underway, signal: "running" };
  assert.deepEqual(statusFromPosition(signal, { running: [OUT], quays: ["Standal", "Trandal"], now: 20 * 60 + 14, fixes: [ais(1, oslo(20, 14, 20), { sog: 0 })], nowMs: oslo(20, 14, 30) }), { ...signal, atQuay: "Trandal" });
  assert.equal(statusFromPosition(null, { running: [], quays: [], fixes: [], nowMs: 0 }), null);
});

test("statuslinja: «ferdig for dagen på Standal» eller «ligg til kai på Standal» men AIS ved Trandal-kaia – AIS vinn; same kai står", () => {
  setLang("nn");
  const nowMs = oslo(20, 40);
  const ctx = { running: [], quays: ["Standal", "Trandal"], now: 20 * 60 + 40, nowMs };
  const fixes = [ais(1, nowMs - 10000, { sog: 0 })]; // Trandal-kaia
  const done = { at: 1240, text: "Ferja er ferdig for dagen på Standal" };
  const fixed = statusFromPosition(done, { ...ctx, fixes });
  assert.equal(fixed.short, "Ferja ligg til kai på Trandal");
  assert.equal(fixed.at, 1240, "same plass i tidslinja");
  const same = { at: 1240, text: "Ferja er ferdig for dagen på Trandal" };
  // Same kai, men «ferdig for dagen»: éi ordlyd, AIS seier «ligg til kai». Fyrste tur står i same setning (toppen).
  const sameQuay = statusFromPosition(same, { ...ctx, fixes });
  assert.equal(sameQuay.short, "Ferja ligg til kai på Trandal");
  assert.equal(sameQuay.atQuay, "Trandal");
  assert.equal(sameQuay.position, "ais");
  // «Ligg til kai på X. Liggetid …» seier alt same ordlyd og blir ikkje rørt.
  const layover = { at: 1240, text: "Ferja ligg til kai på Trandal. Liggetid 5 min, til 20:45." };
  assert.deepEqual(statusFromPosition(layover, { ...ctx, fixes }), { ...layover, atQuay: "Trandal" });
  const wrongQuay = { at: 1240, short: "Ferja ligg til kai på Standal", text: "Ferja ligg til kai på Standal." };
  assert.equal(statusFromPosition(wrongQuay, { ...ctx, fixes }).text, "Ferja ligg til kai på Trandal.");
});

test("status.atQuay: kaia berre ved fersk AIS (ved kai 4 min), ikkje Entur, ikkje i fart", () => {
  const nowMs = oslo(23, 0);
  const quays = ["Standal", "Trandal"];
  const aisQuay = (fixes, quaysIn, at) =>
    statusFromPosition({ short: "Ferdig for dagen", text: "Ferdig for dagen." }, { running: [], fixes, quays: quaysIn, now: 23 * 60, nowMs: at }).atQuay ?? null;
  assert.equal(aisQuay([ais(0, nowMs - 90000, { sog: 0 })], quays, nowMs), "Standal");
  assert.equal(aisQuay([ais(0, nowMs - 3 * 60000, { sog: 0 })], quays, nowMs), "Standal", "3 min sidan: framleis live ved kai");
  assert.equal(aisQuay([ais(0, nowMs - 5 * 60000, { sog: 0 })], quays, nowMs), null, "5 min: siste kjende, ikkje «live»");
  assert.equal(aisQuay([ais(0.5, nowMs - 10000)], quays, nowMs), null, "midt på fjorden");
  assert.equal(aisQuay([{ ...ais(0, nowMs - 5000, { sog: 0 }), source: "entur" }], quays, nowMs), null, "berre AIS");
  assert.equal(aisQuay([], quays, nowMs), null);
});

const FAR = { latitude: 62.45, longitude: 6.2 }; // ~20 km frå ruta: verkstad eller anna samband
const farAis = (at, extra = {}) => fixFromAis({ mmsi: 257297400, ...FAR, sog: 8, cog: 200, timestamp: at, ...extra });

test("utanfor ruta: AIS langt frå alle kaier gjev state «outside», ingen framdrift og ingen tabellpåstand", () => {
  setLang("nn");
  const nowMs = oslo(20, 8);
  const fix = farAis(nowMs - 20000);
  assert.equal(outsideFix([fix], nowMs), fix);
  assert.equal(outsideFix([fix], nowMs, OUT), fix, "òg mot ein planlagd tur");
  const view = crossingView({ leg: OUT, fixes: [fix], nowMs });
  assert.equal(view.state, "outside");
  assert.equal(view.source, "ais");
  assert.equal(view.progress, 0);
  assert.equal(view.left, null);
  assert.equal(crossingBadge(view), "Utanfor ruta · AIS kl. 20:07");
  assert.match(crossingNote(view), /ingen framdrift og følgjer ikkje rutetabellen/);
  assert.equal(crossingProgressText(view), "Utanfor ruta, ingen framdrift");
  assert.match(crossingValueText(view), /utanfor ruta/);
  // Utan overfart (ved kai/før tur): same.
  assert.equal(positionSourceView([fix], nowMs).state, "outside");
  // Held seg «utanfor» når posisjonen vert gammal (ingen retur til «Berekna frå rutetabellen»), men ikkje evig.
  assert.equal(positionSourceView([fix], nowMs + 3 * 3600000).state, "outside");
  assert.equal(outsideFix([fix], nowMs + 13 * 3600000), null);
  // Ei nyare Entur-måling på ruta vinn; på ruta (AIS) er ikkje utanfor.
  const entur = { ...ais(0.5, nowMs), source: "entur" };
  assert.equal(outsideFix([fix, entur], nowMs), null);
  assert.equal(outsideFix([ais(0.5, nowMs - 5000)], nowMs, OUT), null);
  assert.equal(outsideFix([ais(0.5, nowMs - 5000), farAis(nowMs - 90000)], nowMs, OUT), null, "nyaste AIS gjeld");
  assert.equal(outsideFix([fixFromAis({ mmsi: 1, ...S, sog: 0, timestamp: nowMs })], nowMs), null, "ved kai");
  // Kunngjering ved skifte frå live til utanfor ruta.
  const before = crossingView({ leg: OUT, fixes: [ais(0.4, nowMs - 5000)], nowMs });
  const after = { ...view, trip: before.trip };
  assert.equal(crossingAnnouncement(before, after), "Ferja er utanfor ruta.");
});

test("utanfor ruta og ekstraturar: statuslinja tek AIS framfor rutetabellen", () => {
  setLang("nn");
  const nowMs = oslo(20, 8);
  const moored = { at: 20 * 60 + 8, underway: false, short: "Ferja ligg til kai på Standal", text: "Ferja ligg til kai på Standal." };
  const underwayStatus = { at: 20 * 60 + 8, underway: true, text: "Ferja er på veg mot Trandal" };
  const quays = ["Standal", "Trandal"];
  for (const status of [moored, underwayStatus]) {
    const out = statusFromPosition(status, { running: [OUT, BACK], fixes: [farAis(nowMs - 30000)], quays, now: 20 * 60 + 8, nowMs });
    assert.equal(out.outside, true);
    assert.equal(out.underway, false);
    assert.equal(out.text, "Ferja er utanfor ruta. Siste AIS-posisjon kl. 20:07.");
  }
  // Ikkje for signal/avlyst.
  const signal = { ...moored, signal: true };
  assert.deepEqual(statusFromPosition(signal, { running: [OUT], fixes: [farAis(nowMs - 30000)], quays, now: 20 * 60 + 8, nowMs }), signal);
  // I fart i ruteområdet utan passande tur (ekstratur / meir enn 10 min forseinka): ikkje «ligg til kai».
  const lateFix = ais(0.5, nowMs - 10000, { sog: 9 });
  const late = statusFromPosition(moored, { running: [leg("Standal", "Trandal", "19:00:00", "19:15:00")], fixes: [lateFix], quays, now: 20 * 60 + 8, nowMs });
  assert.equal(late.unscheduled, true);
  assert.equal(late.text, "Ferja er i fart, men vi finn ingen planlagd tur som passar.");
  // Utan fartsmelding (null) eller stilleståande: ingen påstand.
  assert.equal(statusFromPosition(moored, { running: [], fixes: [ais(0.5, nowMs - 10000, { sog: 102.3 })], quays, now: 20 * 60 + 8, nowMs }), moored);
  assert.equal(statusFromPosition(moored, { running: [], fixes: [ais(0.5, nowMs - 10000, { sog: 0 })], quays, now: 20 * 60 + 8, nowMs }), moored);
  // Berre «fart» når AIS er fersk.
  assert.equal(statusFromPosition(moored, { running: [], fixes: [ais(0.5, nowMs - 120000, { sog: 9 })], quays, now: 20 * 60 + 8, nowMs }), moored);
});

test("Entur-posisjon med rett tur-id men langt frå strekninga (ferja på veg til turen) høyrer ikkje til overfarten", () => {
  const kalvoy = leg("Valderøya", "Store Kalvøy", "12:15:00", "12:35:00", "MOR:ServiceJourney:1136_615_x#0");
  const standal = { source: "entur", latitude: 62.266468, longitude: 6.423213, at: oslo(12, 14), speedKn: null, course: null, journeyRef: "MOR:ServiceJourney:1136_615_x" };
  const view = crossingView({ leg: kalvoy, fix: standal, nowMs: oslo(12, 14, 30) });
  assert.equal(view.source, "computed", "ingen måling: berre rutetabellen");
  assert.equal(view.measured, false);
  // Same tur-id på strekninga: posisjonen gjeld.
  const V = QUAY_COORDS["Valderøya"];
  const K = QUAY_COORDS["Store Kalvøy"];
  const mid = { ...standal, latitude: (V.latitude + K.latitude) / 2, longitude: (V.longitude + K.longitude) / 2, at: oslo(12, 20) };
  assert.equal(crossingView({ leg: kalvoy, fix: mid, nowMs: oslo(12, 20, 10) }).source, "entur");
});

test("fart: AIS-knop berre på AIS som er live eller siste kjende, i fart og ikkje ved kai; aldri frå Entur eller rutetabell", () => {
  setLang("nn");
  const fix = ais(0.4, oslo(20, 5));
  const at = (ms) => crossingView({ leg: OUT, fix, nowMs: fix.at + ms });
  assert.equal(at(10000).speedKn, 10, "live");
  assert.equal(at(3 * 60000).speedKn, 10, "siste kjende");
  assert.equal(at(7 * 60000).speedKn, null, "for gammal: ukjend");
  assert.equal(aisSpeed(ais(0.4, oslo(20, 5), { sog: 11.4 }), oslo(20, 5, 10)), 11);
  assert.equal(aisSpeed(ais(0.4, oslo(20, 5), { sog: 11.6 }), oslo(20, 5, 10)), 12);
  assert.equal(aisSpeed(ais(0.4, oslo(20, 5), { sog: 0.4 }), oslo(20, 5, 10)), null, "under 0,5 knop: ved kai");
  assert.equal(aisSpeed(ais(0.4, oslo(20, 5), { sog: 0.6 }), oslo(20, 5, 10)), 1, "aldri «0 knop» i fart");
  assert.equal(aisSpeed(ais(0.4, oslo(20, 5), { sog: null }), oslo(20, 5, 10)), null, "ukjend fart (null)");
  assert.equal(aisSpeed(ais(0.4, oslo(20, 5), { sog: 102.3 }), oslo(20, 5, 10)), null, "AIS «ukjend fart» (102,3)");
  assert.equal(aisSpeed({ ...fix, source: "entur" }, fix.at + 5000), null, "Entur har ingen fart");
  assert.equal(crossingView({ leg: OUT, fix: { ...fix, source: "entur" }, nowMs: fix.at + 5000 }).speedKn, null);
  assert.equal(crossingView({ leg: OUT, fix: null, nowMs: oslo(20, 6) }).speedKn, null, "rutetabell");
  assert.equal(crossingView({ leg: OUT, fix: ais(0, oslo(20, 5), { sog: 0 }), nowMs: oslo(20, 5, 10) }).speedKn, null, "ved kai (stille i kairadius)");
  assert.equal(crossingView({ leg: OUT, fix: ais(0, oslo(20, 5), { sog: 8 }), nowMs: oslo(20, 5, 10) }).speedKn, 8, "legg frå kai i fart: farta står");
  // aria-valuetext tek med farta, i alle språk.
  assert.match(crossingValueText(at(10000)), /, målt med AIS, 10 knop$/);
  setLang("en");
  assert.match(crossingValueText(at(10000)), /, measured by AIS, 10 knots$/);
  setLang("de");
  assert.match(crossingValueText(at(10000)), /, 10 Knoten$/);
  setLang("nn");
});

// --- Fleire ferjer på éi strekning (1069 Festøya–Solavågen): kva ferje høyrer til kva tur ---

const F = QUAY_COORDS.Festøya;
const SOL = QUAY_COORDS.Solavågen;
/** Punkt `f` (0..1) på linja Festøya → Solavågen. */
const fest = (f) => ({ latitude: F.latitude + (SOL.latitude - F.latitude) * f, longitude: F.longitude + (SOL.longitude - F.longitude) * f });
// Kurs mellom kaiene (sør og nord) og motsett.
const SOUTH = 5;
const NORTH = 185;
const DOWN = leg("Festøya", "Solavågen", "10:00:00", "10:20:00", "MOR:ServiceJourney:1069_1_x#0");
const UP = leg("Solavågen", "Festøya", "10:05:00", "10:25:00", "MOR:ServiceJourney:1069_2_x#0");
const ferry = (mmsi, f, at, extra = {}) => fixFromAis({ mmsi, ...fest(f), sog: 8, cog: SOUTH, timestamp: at, ...extra });

test("to ferjer om kvarandre: kursen avgjer kva ferje som høyrer til kva tur", () => {
  const now = oslo(10, 12);
  const a = ferry(257090560, 0.6, now - 10000, { cog: headingTo(F, SOL) });
  const b = ferry(257090550, 0.4, now - 10000, { cog: headingTo(SOL, F) });
  assert.equal(fixBelongsTo(a, DOWN, now), true);
  assert.equal(fixBelongsTo(b, DOWN, now), false, "b går mot Festøya: ikkje 10:00-turen");
  assert.equal(fixBelongsTo(b, UP, now), true);
  assert.equal(fixBelongsTo(a, UP, now), false);
  // Framdrifta for kvar tur kjem frå si eiga ferje, same kva ferje som sende sist.
  const down = crossingView({ leg: DOWN, fixes: [b, a], nowMs: now });
  const up = crossingView({ leg: UP, fixes: [a, b], nowMs: now });
  assert.equal(down.source, "ais");
  assert.ok(Math.abs(down.progress - 0.6) < 0.02, `ned ${down.progress}`);
  assert.ok(Math.abs(up.progress - 0.6) < 0.02, `opp ${up.progress} (b er 40 % frå Festøya, altså 60 % frå Solavågen)`);
});

test("to ferjer om kvarandre: ei ferje som ventar ved endekaia før turen har rekt fram, høyrer til neste tur derifrå", () => {
  const now = oslo(10, 8);
  const waiting = ferry(257090550, 1, now - 5000, { sog: 0, cog: null }); // ved Solavågen, venter på 10:05-avgangen
  assert.equal(fixBelongsTo(waiting, DOWN, now), false, "10:00-turen er ikkje framme (10:20)");
  assert.equal(fixBelongsTo(waiting, UP, now), true, "men ho står ved startkaien til 10:05-turen");
  const arrived = ferry(257090550, 1, oslo(10, 19), { sog: 0, cog: null });
  assert.equal(fixBelongsTo(arrived, DOWN, oslo(10, 19, 10)), true, "ved endekaia når turen er framme");
  // Entur-posisjon med tur-id er uendra: tur-id avgjer.
  const entur = { source: "entur", journeyRef: "MOR:ServiceJourney:1069_1_x", latitude: fest(0.5).latitude, longitude: fest(0.5).longitude, at: now, speedKn: null };
  assert.equal(fixBelongsTo(entur, DOWN, now), true);
  assert.equal(fixBelongsTo(entur, UP, now), false);
});

test("ei tredje ferje langt unna (1069) gjer ikkje turen til «utanfor ruta» når ei anna ferje har turen", () => {
  const now = oslo(10, 12);
  const a = ferry(257090560, 0.6, now - 20000, { cog: headingTo(F, SOL) });
  const idle = fixFromAis({ mmsi: 258220500, latitude: 62.47, longitude: 6.15, sog: 0, cog: null, timestamp: now - 5000 });
  const view = crossingView({ leg: DOWN, fixes: [a, idle], nowMs: now });
  assert.equal(view.source, "ais");
  assert.ok(Math.abs(view.progress - 0.6) < 0.02);
  assert.notEqual(view.state, "outside");
  // Utan ferje på turen er det framleis den siste AIS-posisjonen som blir vist som utanfor ruta.
  assert.equal(crossingView({ leg: DOWN, fixes: [idle], nowMs: now }).state, "outside");
});

test("turen er i gang: ferja i fart på strekninga har turen, ikkje reserveferja som ligg parkert ved startkaia", () => {
  const now = oslo(10, 12);
  const moving = ferry(257090560, 0.5, now - 20000, { cog: headingTo(F, SOL) });
  // Parkert ved Festøya (startkaia), nyare melding enn ferja i fart.
  const parked = fixFromAis({ mmsi: 258220500, ...fest(0), sog: 0, cog: null, navStatus: 5, timestamp: now - 2000 });
  assert.equal(fixBelongsTo(parked, DOWN, now), true, "ho ligg ved startkaia, så ho kan høyre til turen før han går");
  const view = crossingView({ leg: DOWN, fixes: [moving, parked], nowMs: now });
  assert.equal(view.atQuay, false);
  assert.ok(Math.abs(view.progress - 0.5) < 0.02);
  // Før avgang er det den parkerte ferja ved kaia som er posisjonen.
  const parkedEarly = { ...parked, at: oslo(9, 59, 50) };
  const before = crossingView({ leg: DOWN, fixes: [parkedEarly], nowMs: oslo(9, 59, 55) });
  assert.equal(before.atQuay, true);
});
