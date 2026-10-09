/**
 * Overfarten som er i gang: kor langt ferja har kome, og kor godt vi veit det.
 * Rein logikk utan DOM. Brukt av framdriftslinja og «Live»-merket i React-skalet.
 *
 * Posisjonen kjem som ein «fix» med kjelde:
 *   "ais"      målt av ferja sjølv (AIS). Ikkje kopla til enno, sjå fixFromAis.
 *   "entur"    sanntidsposisjonen frå Entur (SIRI VM, parseVehicleMonitoring).
 *   "computed" rekna ut frå rutetabellen. Aldri ein måling.
 *
 * Dette er visning, ikkje bevis: ein gammal eller berekna posisjon seier ingenting om
 * at ein tur gjekk. tripStatus/liveProvesSailed avgjer framleis kva som har gått.
 */
import { t } from "../../assets/i18n.js?v=84";
import { clockMinutes, durationText, hhmm, nowMinutes, osloHm } from "./time.js?v=84";
import { quayPlace, serviceJourneyId } from "./legs.js?v=84";
import { QUAY_COORDS, QUAY_RADIUS_M, distanceMeters } from "./live.js?v=84";

/** Yngre enn dette: «Live». */
export const FIX_FRESH_MS = 60 * 1000;
/** Pulsen på live-prikken berre når posisjonen er så fersk. */
export const FIX_PULSE_MS = 30 * 1000;
/** Eldre enn dette: «Ukjent». Mellom fresh og stale: «Siste kjende». */
export const FIX_STALE_MS = 5 * 60 * 1000;
/** AIS klasse A sender kvart 3. minutt ved kai, så då toler vi meir. */
export const AIS_MOORED_FRESH_MS = 4 * 60 * 1000;
export const AIS_MOORED_STALE_MS = 15 * 60 * 1000;
/** Ved kai: innanfor QUAY_RADIUS_M og saktare enn dette. */
export const AT_QUAY_MAX_KN = 0.5;
/** Ein posisjon frå før avgangen (minus dette) høyrer ikkje til overfarten. */
export const FIX_BEFORE_DEPARTURE_MS = 2 * 60 * 1000;

export const FIX_SOURCES = ["ais", "entur", "computed"];

/**
 * @typedef {object} PositionFix
 * @property {"ais"|"entur"|"computed"} source
 * @property {number} latitude
 * @property {number} longitude
 * @property {number} at              epoke-ms då posisjonen vart målt
 * @property {number|null} speedKn    fart over grunn, knop (null = ukjend)
 * @property {number|null} course     kurs over grunn, grader (null = ukjend)
 * @property {boolean|null} atStop    Entur VehicleAtStop
 * @property {boolean} moored         AIS navigasjonsstatus «fortøydd»
 * @property {string} journeyRef      MOR:ServiceJourney:… når kjelda veit turen
 * @property {string} expectedArrival ISO, berre frå Entur
 * @property {string|number} vessel   MMSI eller VehicleRef
 */

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timeOf(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}

function validPosition(lat, lon) {
  return lat != null && lon != null && !(lat === 0 && lon === 0) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

/** Sanntidsposisjonen frå Entur (resultatet av parseVehicleMonitoring). */
export function fixFromLive(live) {
  if (!live) return null;
  const latitude = finite(live.latitude);
  const longitude = finite(live.longitude);
  const at = timeOf(live.recordedAt);
  if (!validPosition(latitude, longitude) || at == null) return null;
  return {
    source: "entur",
    latitude,
    longitude,
    at,
    speedKn: null,
    course: null,
    atStop: live.atStop === true ? true : live.atStop === false ? false : null,
    moored: false,
    journeyRef: serviceJourneyId(live.journeyRef),
    expectedArrival: live.expectedArrival || "",
    vessel: live.vehicleRef || "",
  };
}

/**
 * Inngangen for AIS. Ikkje kopla til noko enno: innsamlaren (eller ein annan kjelde)
 * kan gje dekoda AIS-meldingar hit seinare, ein per fartøy.
 * @param {{ mmsi: number|string, latitude: number, longitude: number, sog?: number,
 *   cog?: number, navStatus?: number, timestamp: number|string }} msg
 *   sog i knop (102.3 = ukjend), cog i grader (360 = ukjend), navStatus 5 = fortøydd.
 * @returns {PositionFix|null}
 */
export function fixFromAis(msg) {
  if (!msg) return null;
  const latitude = finite(msg.latitude);
  const longitude = finite(msg.longitude);
  const at = timeOf(msg.timestamp);
  if (!validPosition(latitude, longitude) || at == null) return null;
  const sog = finite(msg.sog);
  const cog = finite(msg.cog);
  return {
    source: "ais",
    latitude,
    longitude,
    at,
    speedKn: sog != null && sog >= 0 && sog < 102.2 ? sog : null,
    course: cog != null && cog >= 0 && cog < 360 ? cog : null,
    atStop: null,
    moored: Number(msg.navStatus) === 5,
    journeyRef: "",
    expectedArrival: "",
    vessel: msg.mmsi ?? "",
  };
}

/** Nyaste målte posisjon. AIS vinn når to er like gamle. */
export function newestFix(fixes) {
  let best = null;
  for (const fix of fixes || []) {
    if (!fix || fix.source === "computed") continue;
    if (!best || fix.at > best.at || (fix.at === best.at && fix.source === "ais")) best = fix;
  }
  return best;
}

function coords(quay) {
  return QUAY_COORDS[quayPlace(quay)] || null;
}

function distanceTo(fix, quay) {
  const place = coords(quay);
  if (!place || !fix) return null;
  return distanceMeters(fix.latitude, fix.longitude, place.latitude, place.longitude);
}

/**
 * Framdrift 0..1 = avstand frå startkai / (avstand frå startkai + avstand til endekai).
 * null når kaiane eller posisjonen manglar.
 */
export function crossingFraction(fix, from, to) {
  const a = distanceTo(fix, from);
  const b = distanceTo(fix, to);
  if (a == null || b == null) return null;
  if (a + b === 0) return 0;
  return clamp01(a / (a + b));
}

export function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Ved kai: innanfor 250 m og under 0,5 kn. Utan fart: VehicleAtStop eller berre avstand. */
export function fixAtQuay(fix, quay) {
  const distance = distanceTo(fix, quay);
  if (distance == null || distance > QUAY_RADIUS_M) return false;
  if (fix.speedKn != null) return fix.speedKn < AT_QUAY_MAX_KN;
  if (fix.atStop === false) return false;
  return true;
}

function isMoored(fix) {
  return fix.source === "ais" && (fix.moored || (fix.speedKn != null && fix.speedKn < AT_QUAY_MAX_KN));
}

/** "live" ≤ 60 s, "stale" ≤ 5 min, elles "unknown". AIS ved kai har lengre grenser. */
export function fixFreshness(fix, nowMs) {
  if (!fix || fix.source === "computed") return "unknown";
  const age = Math.max(0, nowMs - fix.at);
  const moored = isMoored(fix);
  if (age <= (moored ? AIS_MOORED_FRESH_MS : FIX_FRESH_MS)) return "live";
  if (age <= (moored ? AIS_MOORED_STALE_MS : FIX_STALE_MS)) return "stale";
  return "unknown";
}

function bearing(from, to) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const y = Math.sin(rad(to.longitude - from.longitude)) * Math.cos(rad(to.latitude));
  const x =
    Math.cos(rad(from.latitude)) * Math.sin(rad(to.latitude)) -
    Math.sin(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.cos(rad(to.longitude - from.longitude));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Går ferja frå `from` mot `to`? true/false, eller null når vi ikkje kan seie det.
 * Med kurs og fart: kursen mot endekaien (±90°). Elles: krympar avstanden til endekaien
 * sidan førre posisjon.
 */
export function headingTowards(fix, from, to, previous = null) {
  const target = coords(to);
  if (!fix || !target || !coords(from)) return null;
  if (fix.course != null && fix.speedKn != null && fix.speedKn >= 1) {
    const diff = Math.abs(((fix.course - bearing(fix, target) + 540) % 360) - 180);
    return diff <= 90;
  }
  if (previous && previous.at < fix.at) {
    const before = distanceTo(previous, to);
    const now = distanceTo(fix, to);
    if (before != null && now != null && Math.abs(before - now) >= 50) return now < before;
  }
  return null;
}

/** Oslo-minutt med sekund som brøk, for å samanlikne med rutetider. */
export function preciseMinutes(ms) {
  return nowMinutes(ms) + (((ms % 60000) + 60000) % 60000) / 60000;
}

/** Rutetid i dag (HH:MM:SS) som epoke-ms, rekna frå `nowMs`. */
export function clockMs(time, nowMs) {
  const seconds = Number(String(time).split(":")[2] || 0);
  return nowMs - (preciseMinutes(nowMs) - clockMinutes(time) - seconds / 60) * 60000;
}

/** Ligg posisjonen nær linja mellom kaiane (ikkje på ein annan del av fjorden)? */
function nearRoute(fix, leg) {
  const a = distanceTo(fix, leg.from);
  const b = distanceTo(fix, leg.to);
  const span = coords(leg.from) && coords(leg.to) ? distanceTo(coords(leg.from), leg.to) : null;
  if (a == null || b == null || span == null) return false;
  return a + b <= span * 1.6 + 500;
}

/**
 * Turen posisjonen høyrer til. Fyrst journeyRef (Entur), så nærmaste planlagde avgang
 * der posisjonen ligg på strekninga og retninga ikkje talar imot.
 */
export function matchCrossingLeg(legs, fix, { previous = null } = {}) {
  if (!fix) return null;
  const ref = fix.journeyRef;
  if (ref) {
    const hit = (legs || []).find((leg) => serviceJourneyId(leg.id) === ref);
    if (hit) return hit;
  }
  let best = null;
  let bestGap = Infinity;
  for (const leg of legs || []) {
    if (!leg?.departure || !leg?.arrival) continue;
    const dep = clockMs(leg.departure, fix.at);
    const arr = clockMs(leg.arrival, fix.at);
    if (fix.at < dep - 10 * 60000 || fix.at > arr + 10 * 60000) continue;
    if (!nearRoute(fix, leg)) continue;
    if (headingTowards(fix, leg.from, leg.to, previous) === false) continue;
    const gap = Math.abs(fix.at - dep);
    if (gap < bestGap) {
      best = leg;
      bestGap = gap;
    }
  }
  return best;
}

/** Berekna framdrift: lineært frå avgang til ankomst i rutetabellen. */
export function timetableFraction(leg, nowMs) {
  const start = clockMinutes(leg.departure);
  const end = clockMinutes(leg.arrival);
  if (!(end > start)) return 0;
  return clamp01((preciseMinutes(nowMs) - start) / (end - start));
}

export function tripKey(leg) {
  return leg ? `${leg.id || ""}|${leg.from}|${leg.departure}` : "";
}

/** Høyrer posisjonen til denne overfarten? */
export function fixBelongsTo(fix, leg, nowMs) {
  if (!fix || !leg || fix.source === "computed") return false;
  if (fix.journeyRef) return fix.journeyRef === serviceJourneyId(leg.id);
  if (fix.at < clockMs(leg.departure, nowMs) - FIX_BEFORE_DEPARTURE_MS) return false;
  return nearRoute(fix, leg);
}

/**
 * Alt framdriftslinja treng. `fixes` er alle kjende posisjonar (Entur, AIS per fartøy);
 * berre dei som høyrer til `leg` blir brukte. `previous` er førre resultat (same objekt som vart returnert),
 * så framdrifta for same tur aldri går bakover.
 *
 * @returns {{ trip: string, from: string, to: string, departure: string, arrival: string,
 *   source: "ais"|"entur"|"computed", state: "live"|"stale"|"unknown"|"calc",
 *   measured: boolean, progress: number, percent: number, atQuay: boolean,
 *   fixAt: number|null, ageMs: number|null, pulse: boolean, lastMeasured: number|null }}
 */
export function crossingView({ leg, fix = null, fixes = null, nowMs, previous = null }) {
  if (!leg) return null;
  const trip = tripKey(leg);
  // Berre posisjonar som høyrer til denne overfarten. Nyaste vinn, AIS ved likt.
  const own = newestFix((fixes || [fix]).filter((item) => fixBelongsTo(item, leg, nowMs)));
  let state = "calc";
  let source = "computed";
  let progress = timetableFraction(leg, nowMs);
  let atQuay = false;
  let arrival = hhmm(leg.arrival);
  if (own) {
    const fraction = crossingFraction(own, leg.from, leg.to);
    if (fraction != null) {
      state = fixFreshness(own, nowMs);
      source = own.source;
      progress = fraction;
      if (fixAtQuay(own, leg.to)) {
        atQuay = true;
        progress = 1;
      } else if (fixAtQuay(own, leg.from)) {
        atQuay = true;
        progress = 0;
      }
      if (state === "live" && own.expectedArrival) arrival = osloHm(own.expectedArrival) || arrival;
    }
  }
  progress = clamp01(progress);
  // Monoton per tur: ein ny (eller dårlegare) posisjon flyttar aldri ferja bakover.
  // Unntak: når ein måling avløyser eit anslag frå rutetabellen, vinn målinga (men aldri
  // under ein tidlegare måling på same tur). Eit anslag skal ikkje halde ein målt
  // posisjon framom der ferja faktisk er.
  const same = previous && previous.trip === trip ? previous : null;
  if (same) {
    const replacesEstimate = same.source === "computed" && source !== "computed";
    const floor = replacesEstimate ? same.lastMeasured ?? 0 : same.progress;
    if (floor > progress) progress = floor;
  }
  const lastMeasured = source !== "computed" ? progress : same?.lastMeasured ?? null;
  const ageMs = own ? Math.max(0, nowMs - own.at) : null;
  return {
    trip,
    from: leg.from,
    to: leg.to,
    departure: hhmm(leg.departure),
    arrival,
    source,
    state,
    measured: source !== "computed",
    progress,
    percent: Math.round(progress * 100),
    atQuay,
    fixAt: own ? own.at : null,
    ageMs,
    pulse: state === "live" && ageMs != null && ageMs <= FIX_PULSE_MS,
    lastMeasured,
  };
}

/** Prosent for skjermlesar: runda til næraste 5. */
export function ariaPercent(progress) {
  return Math.round((clamp01(progress) * 100) / 5) * 5;
}

function ageText(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return t("crossing.seconds", { n: seconds });
  return durationText(Math.floor(seconds / 60));
}

function sourceName(source) {
  return source === "ais" ? t("crossing.sourceAis") : t("crossing.sourceEntur");
}

function clockOf(ms) {
  return ms == null ? "" : osloHm(new Date(ms).toISOString());
}

/** Teksten i merket: «Live · AIS · 12 s», «Siste kjende · 3 min sidan», … */
export function crossingBadge(view) {
  if (!view) return "";
  switch (view.state) {
    case "live":
      return t("crossing.live", { source: sourceName(view.source), age: ageText(view.ageMs) });
    case "stale":
      return t("crossing.lastKnown", { age: ageText(view.ageMs) });
    case "unknown":
      return t("crossing.unknownSince", { time: clockOf(view.fixAt) });
    default:
      return t("crossing.calc");
  }
}

/** Kjeldelina under linja. */
export function crossingNote(view) {
  if (!view) return "";
  if (view.state === "calc") return t("crossing.noteCalc");
  if (view.state === "unknown") return t("crossing.noteUnknown");
  if (view.state === "stale") return t("crossing.noteStale", { time: clockOf(view.fixAt) });
  return view.source === "ais" ? t("crossing.noteAis") : t("crossing.noteEntur");
}

/** Synleg tekst ved framdriftslinja. */
export function crossingProgressText(view) {
  if (!view) return "";
  if (view.atQuay && view.progress >= 1) return t("crossing.atQuay", { quay: view.to });
  return t("crossing.progress", { percent: view.percent, time: view.arrival });
}

function sourceKey(view) {
  if (view.state === "calc") return "crossing.srcCalc";
  if (view.state === "unknown") return "crossing.srcUnknown";
  if (view.state === "stale") return "crossing.srcStale";
  return view.source === "ais" ? "crossing.srcAis" : "crossing.srcEntur";
}

/** aria-valuetext: alltid med kjelda. */
export function crossingValueText(view) {
  if (!view) return "";
  return t("crossing.valuetext", {
    percent: ariaPercent(view.progress),
    from: view.from,
    to: view.to,
    source: t(sourceKey(view)),
  });
}

/** Kva den felles live-regionen skal seie når kjelda/tilstanden skifter. "" = ingenting. */
export function crossingAnnouncement(before, after) {
  if (!before || !after || before.trip !== after.trip) return "";
  if (before.state === after.state && before.source === after.source) return "";
  if (after.state === "calc") return t("crossing.annCalc");
  if (after.state === "stale") return t("crossing.annStale");
  if (after.state === "unknown") return t("crossing.annUnknown");
  return t("crossing.annLive");
}

/**
 * Nedteljing til ei rutetid. Over 60 min «om 1 t 05 min», 10–60 min «om 23 min»,
 * under 10 min «om 4:05». `sr` er per minutt, for skjermlesar.
 */
export function countdownParts(time, nowMs) {
  const seconds = Math.max(0, Math.round((clockMs(time, nowMs) - nowMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  let duration;
  if (seconds <= 0) duration = null;
  else if (minutes >= 60) {
    duration = t("countdown.hm", { h: Math.floor(minutes / 60), mm: String(minutes % 60).padStart(2, "0") });
  } else if (minutes >= 10) {
    duration = t("duration.minutes", { n: minutes });
  } else {
    duration = `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  }
  const countdown = duration ? t("countdown.in", { duration }) : t("duration.now");
  const srMinutes = Math.ceil(seconds / 60);
  return {
    seconds,
    tabular: minutes < 10 && seconds > 0,
    text: t("countdown.next", { countdown }),
    sr: srMinutes > 0 ? t("countdown.sr", { n: srMinutes }) : t("countdown.srNow"),
  };
}
