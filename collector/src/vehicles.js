/**
 * Entur Vehicle Positions (GraphQL, v2) og SIRI VM (REST, v1) til same form som appen
 * brukar for sanntid (parseVehicleMonitoring i packages/core/entur.js), pluss litt meir
 * til lagring: linje, fartøy-id, kjelde og når vi såg posisjonen.
 */
import {
  QUAY_COORDS,
  QUAY_RADIUS_M,
  delayMinutes,
  distanceMeters,
  firstKnownQuay,
  parseVehicleMonitoring,
} from "../../packages/core/index.js";

export const VEHICLES_WS_URL = "wss://api.entur.io/realtime/v2/vehicles/subscriptions";
/** Bufra: Entur samlar opp til 5 s eller 20 oppdateringar før dei sender. */
export const BUFFER_TIME_MS = 5000;
export const BUFFER_SIZE = 20;

export const lineRef = (line) => `MOR:Line:${line}`;

/** Felta vi treng. Ingen persondata: fartøy, posisjon, tur og kai. */
export const VEHICLE_FIELDS = `lastUpdated expiration vehicleId destinationName originName delay bearing
  monitored vehicleStatus location { latitude longitude } line { lineRef publicCode }
  serviceJourney { id date } monitoredCall { stopPointRef vehicleAtStop }
  progressBetweenStops { percentage linkDistance }`;

export function subscriptionQuery(line) {
  return `subscription { vehicles(codespaceId: "MOR", lineRef: "${lineRef(line)}", bufferTime: ${BUFFER_TIME_MS}, bufferSize: ${BUFFER_SIZE}) { ${VEHICLE_FIELDS} } }`;
}

/** Næraste kjende kai innanfor QUAY_RADIUS_M, eller "". */
export function quayAt(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return "";
  let best = "";
  let bestDist = Infinity;
  for (const [name, place] of Object.entries(QUAY_COORDS)) {
    const dist = distanceMeters(lat, lon, place.latitude, place.longitude);
    if (dist < bestDist) {
      best = name;
      bestDist = dist;
    }
  }
  return bestDist <= QUAY_RADIUS_M ? best : "";
}

/**
 * Éin VehicleUpdate frå GraphQL til sanntidsobjektet appen brukar.
 * `stopPointRef` er ein NSR:Quay-id utan namn, så kaia blir funnen frå posisjonen.
 * @returns {object|null}
 */
export function fromVehicleUpdate(update, line, observedAt = new Date().toISOString()) {
  if (!update || typeof update !== "object") return null;
  const latitude = update.location?.latitude ?? null;
  const longitude = update.location?.longitude ?? null;
  const atStop = typeof update.monitoredCall?.vehicleAtStop === "boolean" ? update.monitoredCall.vehicleAtStop : null;
  const quay = quayAt(latitude, longitude);
  return {
    line: String(update.line?.publicCode || line),
    vehicleId: update.vehicleId || null,
    source: "stream",
    vehicleStatus: update.vehicleStatus || null,
    observedAt,
    destination: firstKnownQuay(update.destinationName || ""),
    direction: "",
    delayMinutes: delayMinutes(update.delay),
    latitude,
    longitude,
    monitored: update.monitored ?? null,
    journeyRef: update.serviceJourney?.id || null,
    atStop,
    stopName: quay,
    stopPointRef: update.monitoredCall?.stopPointRef || null,
    actualDeparture: null,
    actualArrival: null,
    expectedArrival: null,
    aimedArrival: null,
    originAimed: null,
    validUntil: update.expiration || null,
    recordedAt: update.lastUpdated || update.expiration || null,
  };
}

/** SIRI VM-svar (REST) til same form. Brukar parseVehicleMonitoring frå core. */
export function fromVehicleMonitoring(data, line, observedAt = new Date().toISOString()) {
  const live = parseVehicleMonitoring(data);
  if (!live) return null;
  return {
    line: String(line),
    vehicleId: null,
    source: "rest",
    vehicleStatus: null,
    observedAt,
    stopPointRef: null,
    ...live,
  };
}
