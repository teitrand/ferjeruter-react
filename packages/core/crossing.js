/**
 * Overfarten som er i gang: kor langt ferja har kome, og kor godt vi veit det.
 * Rein logikk utan DOM. Brukt av framdriftslinja og «Live»-merket i React-skalet.
 *
 * Posisjonen kjem som ein «fix» med kjelde, i denne rekkefølgja (bestFix):
 *   "ais"      målt av ferja sjølv (AIS, via workeren). Sanninga for posisjon.
 *   "entur"    sanntidsposisjonen frå Entur (SIRI VM, parseVehicleMonitoring). Neste nivå.
 *   "computed" rekna ut frå rutetabellen. Reserve, aldri ein måling.
 *
 * Dette er visning, ikkje bevis: ein gammal eller berekna posisjon seier ingenting om
 * at ein tur gjekk. tripStatus/liveProvesSailed avgjer framleis kva som har gått.
 */
import { t } from "../../assets/i18n.js?v=84";
import { clockMinutes, durationText, hhmm, nowMinutes, osloHm } from "./time.js?v=84";
import { quayPlace, serviceJourneyId } from "./legs.js?v=84";
import { QUAY_COORDS, QUAY_RADIUS_M, distanceMeters, nearLeg } from "./live.js?v=84";

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
/** … og ein posisjon så lenge etter ankomsttida høyrer heller ikkje til. */
export const FIX_AFTER_ARRIVAL_MS = 15 * 60 * 1000;
/** Turmatching: avgangar så langt før/etter posisjonen er ikkje kandidatar. */
export const MATCH_SLACK_MS = 10 * 60 * 1000;

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
  // null og "" er «ukjend», ikkje 0 (Number(null) er 0, og 0 kn ville sagt «ved kai»).
  if (value == null || value === "") return null;
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
 * Inngangen for AIS: ei dekoda AIS-melding per fartøy. Appen får dei frå workeren
 * (`ais` i GET /v1/latest, sjå web/src/model/sanntid.js).
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
    ...(msg.name ? { name: String(msg.name) } : {}),
  };
}

function nearestQuayM(fix) {
  let best = null;
  for (const quay of Object.values(QUAY_COORDS)) {
    const d = distanceMeters(fix.latitude, fix.longitude, quay.latitude, quay.longitude);
    if (best == null || d < best) best = d;
  }
  return best;
}

/**
 * Den nyaste AIS-posisjonen når han ligg utanfor ruta (ekstratur, omveg, verkstad, anna samband), elles null.
 * Utan `leg`: lenger enn OUTSIDE_AREA_M frå alle kaier. Med `leg`: utanfor korridoren rundt strekninga.
 * Ikkje når ei nyare Entur-måling finst, eller ferja ligg ved ei kai vi kjenner. Posisjonen blir ikkje
 * funnen opp: han er den siste AIS-meldinga, med eigen tid.
 */
export function outsideFix(fixes, nowMs, leg = null) {
  const ais = (fixes || []).filter((fix) => fix?.source === "ais" && Number.isFinite(fix.latitude) && Number.isFinite(fix.longitude));
  const newest = ais.reduce((best, fix) => (!best || fix.at > best.at ? fix : best), null);
  if (!newest || nowMs - newest.at > OUTSIDE_MAX_AGE_MS) return null;
  if ((fixes || []).some((fix) => fix && fix.source !== "ais" && fix.source !== "computed" && fix.at > newest.at)) return null;
  const nearest = nearestQuayM(newest);
  if (nearest == null || nearest <= QUAY_RADIUS_M * 2) return null;
  if (leg ? nearRoute(newest, leg) : nearest <= OUTSIDE_AREA_M) return null;
  return newest;
}

const FRESHNESS_RANK = { live: 2, stale: 1, unknown: 0 };
const SOURCE_RANK = { ais: 2, entur: 1 };

/**
 * Posisjonen vi stolar mest på: AIS > Entur > (utan måling) rutetabell.
 * Fyrst ferskleik (live > siste kjende > ukjend), så kjelde (AIS føre Entur), så nyaste.
 * Ein AIS-posisjon som er live vinn altså alltid; ein gamal AIS-posisjon slår ikkje ein
 * fersk Entur-posisjon (då veit vi meir frå Entur). Mellom ukjende vinn den nyaste, så
 * «ingen sanntid sidan hh:mm» viser siste gong vi faktisk visste noko.
 * `computed` er aldri ein måling og blir hoppa over.
 */
export function bestFix(fixes, nowMs) {
  let best = null;
  let bestRank = -1;
  for (const fix of fixes || []) {
    if (!fix || fix.source === "computed") continue;
    const rank = FRESHNESS_RANK[fixFreshness(fix, nowMs)];
    if (!best) {
      best = fix;
      bestRank = rank;
      continue;
    }
    let better;
    if (rank !== bestRank) better = rank > bestRank;
    else if (rank > 0 && fix.source !== best.source) better = (SOURCE_RANK[fix.source] || 0) > (SOURCE_RANK[best.source] || 0);
    else better = fix.at > best.at || (fix.at === best.at && fix.source === "ais");
    if (better) {
      best = fix;
      bestRank = rank;
    }
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

/** Lenger enn dette frå alle kaier vi kjenner = utanfor ruteområdet (ei ferje midt i ei overfart er maks ~2,5 km frå næraste kai). */
export const OUTSIDE_AREA_M = 4000;
/** Ein AIS-posisjon utanfor ruta gjeld som «utanfor ruta» så lenge han er nyast og ikkje eldre enn dette. */
export const OUTSIDE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

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
 * Turen posisjonen høyrer til, innanfor tidsvindauget rundt rutetida (`nowMs` = i dag).
 * Fyrst journeyRef (Entur), så nærmaste planlagde avgang
 * der posisjonen ligg på strekninga og retninga ikkje talar imot.
 */
export function matchCrossingLeg(legs, fix, { previous = null, nowMs = null } = {}) {
  if (!fix) return null;
  // ServiceJourney-id-ane går att kvar dag, så også ref-treffet må liggje i tidsvindauget.
  // Rutetidene gjeld dagen `nowMs` er i (i dag); utan nowMs dagen posisjonen er frå.
  const day = nowMs ?? fix.at;
  const inWindow = (leg) =>
    fix.at >= clockMs(leg.departure, day) - MATCH_SLACK_MS && fix.at <= clockMs(leg.arrival, day) + MATCH_SLACK_MS;
  const ref = fix.journeyRef;
  if (ref) {
    const hit = (legs || []).find((leg) => serviceJourneyId(leg.id) === ref && inWindow(leg));
    if (hit) return hit;
  }
  let best = null;
  let bestGap = Infinity;
  for (const leg of legs || []) {
    if (!leg?.departure || !leg?.arrival) continue;
    const dep = clockMs(leg.departure, day);
    if (!inWindow(leg)) continue;
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

/** Ei ferje som står stille ved endekaia lenger før ankomsttida enn dette, høyrer ikkje til turen (fixBelongsTo). */
const EARLY_ARRIVAL_MS = 5 * 60000;

/** Høyrer posisjonen til denne overfarten? */
export function fixBelongsTo(fix, leg, nowMs) {
  if (!fix || !leg || fix.source === "computed") return false;
  // Same tidsvindauge med og utan journeyRef: id-ane går att kvar dag, og ein posisjon
  // frå før avgangen eller lenge etter ankomsten seier ingenting om denne overfarten.
  if (fix.at < clockMs(leg.departure, nowMs) - FIX_BEFORE_DEPARTURE_MS) return false;
  if (fix.at > clockMs(leg.arrival, nowMs) + FIX_AFTER_ARRIVAL_MS) return false;
  if (fix.at > nowMs + FIX_BEFORE_DEPARTURE_MS) return false;
  // Rett tur-id er ikkje nok: Entur koplar ferja til turen før ho er ved startkaien, så posisjonen må òg liggje på strekninga.
  if (fix.journeyRef) return fix.journeyRef === serviceJourneyId(leg.id) && nearLeg(fix, leg) !== false;
  if (fix.source === "ais") {
    // AIS har ingen tur-id, og to ferjer kan gå samtidig på same strekning (1069). Då avgjer kursen og kaia kva tur ferja har:
    // går ho frå endekaia mot startkaien, er det den motsette turen,
    if (headingTowards(fix, leg.from, leg.to) === false) return false;
    // og står ho stille ved endekaia før turen har rekt fram, ventar ho på neste avgang derifrå.
    const still = fix.moored || fix.speedKn == null || fix.speedKn < AT_QUAY_MAX_KN;
    if (still && fixAtQuay(fix, leg.to) && !fixAtQuay(fix, leg.from) && fix.at < clockMs(leg.arrival, nowMs) - EARLY_ARRIVAL_MS) return false;
  }
  return nearRoute(fix, leg);
}

/**
 * Posisjonen som høyrer til denne overfarten: berre posisjonar som passar turen (fixBelongsTo), AIS > Entur (bestFix).
 * Når turen er i gang, er det ferja i fart på strekninga som har turen, ikkje ei som ligg parkert ved kaia (reserveferja på 1069).
 * @returns {PositionFix|null}
 */
export function fixForLeg(fixes, leg, nowMs) {
  const owned = (fixes || []).filter((item) => fixBelongsTo(item, leg, nowMs));
  const underway = nowMs >= clockMs(leg.departure, nowMs) ? owned.filter((item) => item.source === "ais" && !isMoored(item) && fixFreshness(item, nowMs) === "live") : [];
  return bestFix(underway.length ? underway : owned, nowMs);
}

/**
 * Fart i knop frå AIS, avrunda, til «11 knop». Berre når posisjonen kjem frå AIS og er live eller siste kjende
 * (ikkje «ukjend»), og ferja er i fart (minst AT_QUAY_MAX_KN). Entur og rutetabellen har ingen fart, så der er det null.
 * @returns {number|null}
 */
export function aisSpeed(fix, nowMs) {
  if (!fix || fix.source !== "ais" || fix.moored || fix.speedKn == null || fix.speedKn < AT_QUAY_MAX_KN) return null;
  if (fixFreshness(fix, nowMs) === "unknown") return null;
  return Math.max(1, Math.round(fix.speedKn));
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
  // Ferja ligg utanfor ruta: ingen framdrift, og vi påstår ikkje at ho følgjer rutetabellen.
  // Berre posisjonar som høyrer til denne overfarten. AIS > Entur (bestFix), elles rutetabellen.
  const own = fixForLeg(fixes || [fix], leg, nowMs);
  // Har ei ferje turen, er det ikkje «utanfor ruta» fordi ei anna ferje på linja (1069) ligg ein annan stad.
  const away = own ? null : outsideFix(fixes || [fix], nowMs, leg);
  if (away) return outsideView(away, nowMs, { trip, from: leg.from, to: leg.to, departure: hhmm(leg.departure), arrival: hhmm(leg.arrival) }, previous);
  let state = "calc";
  let source = "computed";
  let progress = timetableFraction(leg, nowMs);
  let atQuay = false;
  let arrival = hhmm(leg.arrival);
  const freshness = own ? fixFreshness(own, nowMs) : null;
  const fraction = own ? crossingFraction(own, leg.from, leg.to) : null;
  if (own && freshness === "unknown") {
    // Eldre enn FIX_STALE_MS: ikkje lenger ein måling vi stolar på. Framdrifta kjem frå
    // rutetabellen; merket kan framleis seie «Ukjent · ingen sanntid sidan hh:mm».
    state = "unknown";
  } else if (own && fraction != null) {
    state = freshness;
    source = own.source;
    progress = fraction;
    // «Ved kai» berre på fersk posisjon (eller AIS ved kai, som sender sjeldnare).
    const trusted = state === "live" || (state === "stale" && own.source === "ais");
    if (trusted && fixAtQuay(own, leg.to)) {
      atQuay = true;
      progress = 1;
    } else if (trusted && fixAtQuay(own, leg.from)) {
      atQuay = true;
      progress = 0;
    }
    if (state === "live" && own.expectedArrival) arrival = osloHm(own.expectedArrival) || arrival;
  }
  progress = clamp01(progress);
  // Monoton per tur: ferja går ikkje bakover.
  //  - målt → målt og berekna → berekna: aldri under førre verdi.
  //  - berekna → målt: målinga vinn over anslaget, men aldri under ein tidlegare måling.
  //  - målt → berekna fordi posisjonen forsvann (calc): står der målinga var.
  //  - målt → ukjent (målinga er for gammal): ingen golv frå målinga, berre frå anslag.
  // `previous` er førre resultat for same LiveCrossing (ein ref i usePositionState), så
  // golvet forsvinn når komponenten blir avmontert (ny lasting, anna rute).
  const same = previous && previous.trip === trip ? previous : null;
  if (same) {
    const measured = source !== "computed";
    let floor;
    if (measured) floor = same.source === "computed" ? same.lastMeasured ?? 0 : same.progress;
    else if (same.source !== "computed") floor = state === "unknown" ? same.lastEstimate ?? 0 : same.progress;
    else floor = same.progress;
    if (floor > progress) progress = floor;
  }
  const lastMeasured = source !== "computed" ? progress : state === "unknown" ? null : same?.lastMeasured ?? null;
  const lastEstimate = source === "computed" ? progress : same?.lastEstimate ?? null;
  const ageMs = own ? Math.max(0, nowMs - own.at) : null;
  // Minutt att til framkomst (rundt ned, så vi aldri lovar meir tid enn det er). null når tida er ute.
  const arrivalMs = clockMs(arrival, nowMs);
  const left = arrivalMs > nowMs ? Math.floor((arrivalMs - nowMs) / 60000) : null;
  return {
    trip,
    from: leg.from,
    to: leg.to,
    departure: hhmm(leg.departure),
    arrival,
    left,
    source,
    state,
    measured: source !== "computed",
    progress,
    percent: Math.round(progress * 100),
    atQuay,
    // Fart (knop) berre frå AIS og berre i fart mellom kaiane; elles null.
    speedKn: own && state !== "unknown" && !atQuay ? aisSpeed(own, nowMs) : null,
    fixAt: own ? own.at : null,
    ageMs,
    pulse: state === "live" && ageMs != null && ageMs <= FIX_PULSE_MS,
    seenLive: state === "live" || Boolean(same?.seenLive),
    lastMeasured,
    lastEstimate,
  };
}

/** Visinga når AIS seier at ferja er utanfor ruta: berre kjelde og tid, ingen framdrift (percent 0 er ikkje ein måling). */
function outsideView(fix, nowMs, trip, previous) {
  return {
    ...trip,
    left: null,
    source: "ais",
    state: "outside",
    measured: true,
    progress: 0,
    percent: 0,
    atQuay: false,
    fixAt: fix.at,
    ageMs: Math.max(0, nowMs - fix.at),
    pulse: false,
    seenLive: Boolean(previous && previous.trip === trip.trip && previous.seenLive),
    lastMeasured: null,
    lastEstimate: null,
  };
}

/**
 * Kjelda når ferja ikkje er på overfart (ved kai, før fyrste tur): same merke, utan linje.
 * Nyaste målte posisjon avgjer; utan posisjon er statusen berekna frå rutetabellen.
 */
export function positionSourceView(fixes, nowMs, previous = null) {
  const away = outsideFix(fixes, nowMs);
  if (away) return outsideView(away, nowMs, { trip: "", from: "", to: "", departure: "", arrival: "" }, previous);
  const own = bestFix(fixes, nowMs);
  const state = own ? fixFreshness(own, nowMs) : "calc";
  const trusted = own && state !== "unknown";
  const ageMs = own ? Math.max(0, nowMs - own.at) : null;
  return {
    trip: "",
    source: trusted ? own.source : "computed",
    state,
    measured: Boolean(trusted),
    fixAt: own ? own.at : null,
    ageMs,
    pulse: state === "live" && ageMs != null && ageMs <= FIX_PULSE_MS,
    seenLive: state === "live" || Boolean(previous && previous.trip === "" && previous.seenLive),
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

/** Nøkkel med kjelda i namnet: crossing.liveAis, crossing.lastKnownEntur, … (calc og unknown har ingen kjelde og kjem ikkje hit). */
const withSource = (base, source) => (source === "ais" ? `${base}Ais` : `${base}Entur`);

function clockOf(ms) {
  return ms == null ? "" : osloHm(new Date(ms).toISOString());
}

/** Teksten i merket, med den verkelege kjelda: «Live frå AIS · 12 s», «Siste kjende frå Entur · 3 min sidan», … */
export function crossingBadge(view) {
  if (!view) return "";
  switch (view.state) {
    case "live":
      return t(withSource("crossing.live", view.source), { age: ageText(view.ageMs) });
    case "stale":
      return t(withSource("crossing.lastKnown", view.source), { age: ageText(view.ageMs) });
    case "unknown":
      return t("crossing.unknownSince", { time: clockOf(view.fixAt) });
    case "outside":
      return t("crossing.outside", { time: clockOf(view.fixAt) });
    default:
      return t("crossing.calc");
  }
}

/** Kjeldelina under linja. */
export function crossingNote(view) {
  if (!view) return "";
  if (view.state === "calc") return t("crossing.noteCalc");
  if (view.state === "outside") return t("crossing.noteOutside");
  if (view.state === "unknown") return t("crossing.noteUnknown");
  if (view.state === "stale") return t(withSource("crossing.noteStale", view.source), { time: clockOf(view.fixAt) });
  return view.source === "ais" ? t("crossing.noteAis") : t("crossing.noteEntur");
}

/** Synleg tekst ved framdriftslinja. */
export function crossingProgressText(view) {
  if (!view) return "";
  if (view.state === "outside") return t("crossing.progressOutside");
  if (view.atQuay && view.progress >= 1) return t("crossing.atQuay", { quay: view.to });
  // «om 9 min» etter framkomsttida, berre når det er minst eitt minutt att.
  const left = view.left >= 1 ? ` · ${t("countdown.in", { duration: durationText(view.left) })}` : "";
  // Berekna: «ca.» og «planlagt framme», så det ikkje ser ut som ein måling.
  if (!view.measured) return t("crossing.progressCalc", { percent: view.percent, time: view.arrival }) + left;
  return t("crossing.progress", { percent: view.percent, time: view.arrival }) + left;
}

function sourceKey(view) {
  if (view.state === "outside") return "crossing.srcOutside";
  if (view.state === "calc") return "crossing.srcCalc";
  if (view.state === "unknown") return "crossing.srcUnknown";
  if (view.state === "stale") return withSource("crossing.srcStale", view.source);
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
  }) + (view.speedKn != null ? `, ${t("speed.knots", { n: view.speedKn })}` : "");
}

/**
 * Kva den felles live-regionen skal seie. "" = ingenting.
 * Berre: til «Ukjent» eller «Berekna» etter at vi har hatt live, og tilbake til live
 * etter «Ukjent». Aldri for live ↔ siste kjende, og aldri for posisjonsoppdateringar.
 */
export function crossingAnnouncement(before, after) {
  if (!before || !after || before.trip !== after.trip) return "";
  if (before.state === after.state) return "";
  if (after.state === "outside" && before.seenLive) return t("crossing.annOutside");
  if ((after.state === "unknown" || after.state === "calc") && before.seenLive) {
    return t(after.state === "calc" ? "crossing.annCalc" : "crossing.annUnknown");
  }
  if (after.state === "live" && before.state === "unknown") return t("crossing.annLive");
  return "";
}

const NBSP = "\u00a0";

/** «3 timar og 18 minutt» med fulle ord, til skjermlesar. */
export function spokenDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [];
  if (hours) parts.push(t(hours === 1 ? "countdown.srHour" : "countdown.srHours", { n: hours }));
  if (rest) parts.push(t(rest === 1 ? "countdown.srMinute" : "countdown.srMinutes", { n: rest }));
  return parts.join(t("countdown.srAnd"));
}

/**
 * Nedteljing til ei rutetid (Designer): minutt rundt ned, éi setning, aldri «3:18».
 * Frå ein time «om 3 t 18 min» (heile timar «om 2 t»), 1–59 min «om 12 min», under 1 min «om under 1 min».
 * Hardt mellomrom mellom tal og eining. `srPhrase` har fulle ord («om 3 timar og 18 minutt») og endrar seg berre kvart minutt.
 * `dayAhead`: avgangen er i morgon (tida gjeld neste døgn, t.d. 1069 som går heile natta).
 */
export function countdownParts(time, nowMs, { dayAhead = 0 } = {}) {
  const target = clockMs(time, nowMs + dayAhead * 86400000);
  const seconds = Math.max(0, Math.round((target - nowMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  let duration;
  let spoken;
  if (seconds <= 0) {
    duration = null;
  } else if (minutes < 1) {
    duration = t("countdown.under");
    spoken = t("countdown.srUnder");
  } else {
    duration = durationText(minutes).replace(/(\d) /g, `$1${NBSP}`);
    spoken = spokenDuration(minutes);
  }
  const countdown = duration ? t("countdown.in", { duration }) : t("duration.now");
  return {
    seconds,
    tabular: false,
    text: t("countdown.next", { countdown }),
    sr: duration ? t("countdown.srNext", { spoken: t("countdown.in", { duration: spoken }) }) : t("countdown.srNow"),
    // Berre «om 12 min», til bruk inne i statuslinja.
    phrase: countdown,
    srPhrase: duration ? t("countdown.in", { duration: spoken }) : t("duration.now"),
  };
}

/**
 * Kaia ferja ligg ved ifølgje fersk AIS (live), elles null. Same grense som «Live frå AIS»: ved kai 4 minutt.
 * Går ut som `status.atQuay`, så «No»-raden seier «ligg til kai på X» frå AIS òg når rutetabellen seier «ferdig for dagen».
 */
function aisQuay(fixes, quays, nowMs) {
  const best = bestFix(fixes, nowMs);
  if (!best || best.source !== "ais" || fixFreshness(best, nowMs) !== "live") return null;
  return (quays || []).find((name) => fixAtQuay(best, name)) || null;
}

/** Mot-seiingane over: ny status når AIS og rutetabellen er usamde, elles same objekt. */
function overrideFromPosition(status, { running, fixes, quays, now, nowMs }) {
  if (!status || status.signal || status.cancelled) return status;
  // AIS seier at ferja er utanfor ruta: det vinn over rutetabellen, òg når AIS-meldinga er nokre minutt gammal.
  const away = outsideFix(fixes, nowMs);
  if (away) {
    return {
      at: now,
      underway: false,
      outside: true,
      short: t("status.outside"),
      text: `${t("status.outsideSince", { time: osloHm(new Date(away.at).toISOString()) })}.`,
      position: "ais",
    };
  }
  const best = bestFix(fixes, nowMs);
  if (!best || best.source !== "ais" || fixFreshness(best, nowMs) !== "live") return status;
  const quay = (quays || []).find((name) => fixAtQuay(best, name)) || null;
  if (quay) {
    const text = t("status.mooredAt", { quay });
    if (!status.underway) {
      // «Ligg til kai på X» (òg «… Liggetid …», «… Fyrste avgang …») står som det er. Alt anna (ferdig for dagen,
      // tomkøyring, startar dagen) seier AIS imot, så éi ordlyd: «Ferja ligg til kai på X». Dagen er då ikkje «ferdig»
      // i teksten, men fyrste tur står i same setning (statuslinja).
      if (String(status.short || status.text).startsWith(text)) return status;
      return { ...status, short: text, text: `${text}.`, position: "ais" };
    }
    // Ikkje avgått enno: raden «No» skal ligge føre avgangen, elles etter turen vi var på.
    const leg = (running || []).find((item) => now >= clockMinutes(item.departure) && now < clockMinutes(item.arrival));
    const atOrigin = leg && quayPlace(leg.from) === quayPlace(quay);
    return {
      at: atOrigin ? clockMinutes(leg.departure) - 0.5 : now,
      short: text,
      text: `${text}.`,
      position: "ais",
    };
  }
  if (status.underway) return status;
  if (best.speedKn != null && best.speedKn < AT_QUAY_MAX_KN) return status;
  const leg = matchCrossingLeg(running, best, { nowMs });
  if (!leg) {
    // Fersk AIS i fart i ruteområdet, men ingen planlagd tur passar (ekstratur, eller meir enn 10 min forseinka): ikkje
    // «ligg til kai» eller «ferdig for dagen», og ikkje ein påstått tur.
    if (best.speedKn != null && best.speedKn >= AT_QUAY_MAX_KN && !status.underway) {
      return { at: now, underway: false, unscheduled: true, short: t("status.unscheduled"), text: `${t("status.unscheduled")}.`, position: "ais" };
    }
    return status;
  }
  return {
    at: now,
    underway: true,
    text: t("status.underwayTo", { dest: leg.to }),
    position: "ais",
  };
}

/**
 * Statuslinja etter posisjonen vi stolar på. AIS er sanninga: seier ein fersk AIS-posisjon noko anna enn
 * statusen frå rutetabellen (og Entur-beviset), vinn AIS. Rører berre mot-seiingar:
 *  - rutetabellen seier «på veg», AIS seier ved kai (innanfor 250 m, < 0,5 kn): «Ferja ligg til kai på X»
 *  - rutetabellen seier ved kai, AIS viser ferja i fart på ein tur: «Ferja er på veg mot Y»
 * Elles (same syn, ingen AIS, eldre AIS, Entur som kjelde, signalturar) blir statusen uendra: Entur gjev alt
 * forseinking og bevis gjennom currentStatus. Pur: `running` er runningLegs, `quays` knownQuays.
 *
 * @param {object|null} status   currentStatus
 * @returns {object|null}        statusen, med `atQuay` (kaia fersk AIS viser ferja ved) når AIS er ved kai
 */
export function statusFromPosition(status, ctx) {
  const out = overrideFromPosition(status, ctx);
  // Éi kjelde for «ligg til kai på X»: «No»-raden les status.atQuay i staden for å rekne AIS-kaia ut på nytt.
  const atQuay = out && !out.outside ? aisQuay(ctx.fixes, ctx.quays, ctx.nowMs) : null;
  return atQuay ? { ...out, atQuay } : out;
}
