/**
 * Sanntid frå Entur (SIRI VM og avlysingar), fartøy og posisjon.
 * Rein logikk utan DOM, flytta uendra frå assets/app.js.
 */
import { clockMinutes, hhmm, nowMinutes, osloHm, osloParts, todayIso } from "./time.js?v=84";
import { quayPlace, serviceJourneyId, unwrapSiri } from "./legs.js?v=84";

/** Stoppestader der vi spør Entur om avlyste avgangar. */
export const STOP_PLACES = {
  Standal: "NSR:StopPlace:39713",
  Trandal: "NSR:StopPlace:58521",
  Sæbø: "NSR:StopPlace:58765",
  Skår: "NSR:StopPlace:41385",
  Leknes: "NSR:StopPlace:58766",
  Valderøya: "NSR:StopPlace:61752",
  "Store Kalvøy": "NSR:StopPlace:58525",
  // 1049 Festøya–Hundeidvik (NSR, henta frå Entur 10. okt. 2026).
  Hundeidvik: "NSR:StopPlace:58756",
  Festøya: "NSR:StopPlace:38754",
};

export const LIVE_MAX_AGE_MS = 3 * 60 * 1000;

/** Signalturar kan gå nokre minutt før rutetida (sett 5 min i signalloggen). */
export const SAILED_EARLY_MIN = 10;

export const VESSEL_UTFORT_RE = /utført av\s+(?:m\/?f\.?\s*)?(geiranger|kvernes)/i;

export function titleVessel(name) {
  const key = String(name || "").toLowerCase();
  if (key === "geiranger") return "Geiranger";
  if (key === "kvernes") return "Kvernes";
  return null;
}

export function vesselFromText(text) {
  const blob = text || "";
  const performed = blob.match(VESSEL_UTFORT_RE);
  if (performed) return titleVessel(performed[1]);
  const names = [...blob.matchAll(/\b(?:m\/?f\.?\s*)?(geiranger|kvernes)\b/gi)].map((match) =>
    match[1].toLowerCase()
  );
  const unique = [...new Set(names)];
  if (unique.length === 1) return titleVessel(unique[0]);
  return null;
}

export function messageVessel(msg) {
  if (!msg) return null;
  return msg.vessel || vesselFromText(`${msg.heading || ""} ${msg.text || ""}`) || null;
}

export function defaultVesselName(table) {
  if (table === "1135") return "Geiranger";
  if (table === "1136") return "Kvernes";
  return null;
}

export function phoneDigits(phone) {
  const digits = String(phone || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("47") && digits.length >= 10) return digits.slice(-8);
  return digits;
}

export function telHref(phone) {
  const digits = phoneDigits(phone);
  return digits ? `tel:+47${digits}` : "";
}

export function observationMinutes(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = osloParts(new Date(ms));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

/**
 * Fersk sanntid viser at ferja har køyrt `leg`: faktisk avgang, framme ved endekaia
 * etter planlagd avgang (ActualArrivalTime eller VehicleAtStop der), eller lagt frå
 * startkaien etter rutetida.
 */
export function liveProvesSailed(live, leg, now = nowMinutes()) {
  if (!leg || !isLiveFresh(live)) return false;
  if (live.actualDeparture) return true;
  const dest = quayPlace(leg.to);
  const stop = quayPlace(live.stopName);
  if (dest && stop === dest && (live.atStop === true || Boolean(live.actualArrival))) {
    // Ved endekaia før rutetida kan Entur alt ha kopla ferja til neste tur. Då er det ikkje bevis.
    // Ferja ved endekaia har heller ikkje «lagt frå startkaien» for denne turen.
    const seenAt = observationMinutes(live.actualArrival) ?? now;
    return seenAt >= clockMinutes(leg.departure);
  }
  return leftOrigin(live, leg) === true && now >= clockMinutes(leg.departure) - SAILED_EARLY_MIN;
}

export function delayMinutes(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Math.floor(value / 60);
  const text = String(value);
  const iso = text.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (iso) {
    const hours = Number(iso[1] || 0);
    const minutes = Number(iso[2] || 0);
    const seconds = Number(iso[3] || 0);
    return Math.floor(hours * 60 + minutes + seconds / 60);
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) ? Math.floor(numeric / 60) : null;
}

/** Stoppestader frå Entur. Nærare enn dette reknar vi ferja som liggjande til kai. */
export const QUAY_RADIUS_M = 250;

export const QUAY_COORDS = {
  Standal: { latitude: 62.266216, longitude: 6.423177 },
  Trandal: { latitude: 62.260997, longitude: 6.500688 },
  Sæbø: { latitude: 62.210998, longitude: 6.475821 },
  Skår: { latitude: 62.17922, longitude: 6.533571 },
  Leknes: { latitude: 62.205859, longitude: 6.5345 },
  Valderøya: { latitude: 62.495872, longitude: 6.128569 },
  "Store Kalvøy": { latitude: 62.526923, longitude: 6.20374 },
  // 1049. Festøya har to NSR-kaier (66979, 66976) ~90 m frå kvarandre; her midtpunktet.
  Hundeidvik: { latitude: 62.371677, longitude: 6.424135 },
  Festøya: { latitude: 62.375, longitude: 6.331668 },
};

export function cancellationQuery(stops) {
  const fields = stops
    .map((name, index) => {
      const id = STOP_PLACES[name];
      return `s${index}: stopPlace(id: "${id}") { estimatedCalls(startTime: $start, timeRange: 86400, numberOfDepartures: 40, includeCancelledTrips: true, whiteListed: { lines: ["MOR:Line:1136", "MOR:Line:1135", "MOR:Line:1049"] }) { cancellation aimedDepartureTime actualDepartureTime serviceJourney { id } } }`;
    })
    .join("\n");
  return `query Cancelled($start: DateTime!) { ${fields} }`;
}

export function callsFromCancellationPayload(payload) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  if (!data || typeof data !== "object") return [];
  const groups = Array.isArray(data) ? data : Object.values(data);
  const calls = [];
  for (const group of groups) {
    const list = Array.isArray(group) ? group : group?.estimatedCalls;
    if (Array.isArray(list)) calls.push(...list);
  }
  return calls;
}

export function cancelledJourneyIds(payload) {
  const ids = new Set();
  for (const call of callsFromCancellationPayload(payload)) {
    if (!call?.cancellation) continue;
    const id = serviceJourneyId(call.serviceJourney?.id || call.id);
    if (id) ids.add(id);
  }
  return ids;
}

export function seenJourneyIds(payload) {
  const ids = new Set();
  for (const call of callsFromCancellationPayload(payload)) {
    const id = serviceJourneyId(call.serviceJourney?.id || call.id);
    if (id) ids.add(id);
  }
  return ids;
}

export function actualDeparturesFromPayload(payload, dayIso = todayIso()) {
  const found = new Map();
  for (const call of callsFromCancellationPayload(payload)) {
    const aimed = call?.aimedDepartureTime || "";
    if (aimed && dayIso && !String(aimed).startsWith(dayIso)) continue;
    const id = serviceJourneyId(call.serviceJourney?.id || call.id);
    const actual = call?.actualDepartureTime;
    if (id && actual && !found.has(id)) found.set(id, actual);
  }
  return found;
}

export function siriBool(value) {
  if (value === true || value === false) return value;
  const text = unwrapSiri(value).toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  return null;
}

export function distanceMeters(lat1, lon1, lat2, lon2) {
  const radius = 6371000;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function distanceToQuay(live, quay) {
  const place = QUAY_COORDS[quayPlace(quay)];
  const lat = Number(live?.latitude);
  const lon = Number(live?.longitude);
  if (!place || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null;
  return distanceMeters(lat, lon, place.latitude, place.longitude);
}

export function legForLive(legs, live) {
  if (!live) return null;
  const ref = serviceJourneyId(live.journeyRef);
  if (ref) {
    const hit = (legs || []).find((leg) => serviceJourneyId(leg.id) === ref);
    if (hit) return hit;
  }
  const aimed = osloHm(live.originAimed);
  if (!aimed) return null;
  const stop = quayPlace(live.stopName);
  return (
    (legs || []).find((leg) => {
      if (hhmm(leg.departure) !== aimed) return false;
      if (!stop) return true;
      if (quayPlace(leg.from) === stop) return true;
      const dist = distanceToQuay(live, leg.from);
      return dist != null && dist <= QUAY_RADIUS_M;
    }) || null
  );
}

/**
 * Har ferja lagt frå kaien turen startar på?
 * true = lagt frå, false = ligg framleis der, null = veit ikkje.
 */
/**
 * Er posisjonen på eller nær strekninga til turen (korridoren mellom kaiene)? true/false, null når vi ikkje har koordinatar.
 * Ei ferje som ligg langt unna strekninga (t.d. ved Standal medan turen går Valderøya → Store Kalvøy) er på veg til
 * turen eller på ein annan tur; ho har ikkje lagt frå kai på denne.
 */
export function nearLeg(live, leg) {
  const from = QUAY_COORDS[quayPlace(leg?.from)];
  const to = QUAY_COORDS[quayPlace(leg?.to)];
  const a = distanceToQuay(live, leg?.from);
  const b = distanceToQuay(live, leg?.to);
  if (!from || !to || a == null || b == null) return null;
  const span = distanceMeters(from.latitude, from.longitude, to.latitude, to.longitude);
  return a + b <= span * 1.6 + 500;
}

export function leftOrigin(live, leg) {
  if (!live || !leg) return null;
  if (live.actualDeparture) return true;
  const origin = quayPlace(leg.from);
  const stop = quayPlace(live.stopName);
  if (live.atStop === true && stop === origin) return false;
  if (live.atStop === true && stop && stop !== origin) return true;
  const dist = distanceToQuay(live, origin);
  if (dist != null) {
    if (dist <= QUAY_RADIUS_M) return false;
    // Langt frå startkaien er berre «har lagt frå» når posisjonen ligg på strekninga. Elles er ferja på veg til turen
    // (Entur koplar ho til turen før ho er ved startkaien), og vi veit ikkje.
    return nearLeg(live, leg) === false ? null : true;
  }
  if (live.atStop === false && stop && stop !== origin) return true;
  if (live.atStop === true) return false;
  return null;
}

export function isLiveFresh(live) {
  if (!live) return false;
  if (live.validUntil) {
    const until = Date.parse(live.validUntil);
    if (Number.isFinite(until)) return until > Date.now();
  }
  if (live.recordedAt) {
    const recorded = Date.parse(live.recordedAt);
    if (Number.isFinite(recorded)) return Date.now() - recorded < LIVE_MAX_AGE_MS;
  }
  return false;
}

export function recordedMs(live) {
  if (!live) return 0;
  const raw = live.recordedAt || live.validUntil;
  const ms = raw ? Date.parse(raw) : 0;
  return Number.isFinite(ms) ? ms : 0;
}

export function pickFreshest(lives) {
  const fresh = lives.filter((live) => isLiveFresh(live));
  const pool = fresh.length ? fresh : lives;
  return pool.slice().sort((a, b) => recordedMs(b) - recordedMs(a))[0] || null;
}
