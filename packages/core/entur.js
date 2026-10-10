/**
 * Entur: sanntid (Vehicle Monitoring) og dagens turar frå Journey Planner
 * (avlysingar og faktiske avgangar), pluss minnet om turar sanntida har vist køyrde.
 *
 * Delt mellom vanilla-appen og React-skalet. Nettkall tek `fetchImpl` som parameter,
 * og minnet tek `storage`, så alt kan testast utan nettlesar. Kva som er lagra i
 * appen (tidspunkt, backoff, tilstand) ligg hos kallaren.
 */
import { clockMinutes, nowMinutes, osloDayStartIso } from "./time.js?v=84";
import { quayPlace, serviceJourneyId, unwrapSiri } from "./legs.js?v=84";
import {
  STOP_PLACES,
  actualDeparturesFromPayload,
  cancellationQuery,
  cancelledJourneyIds,
  delayMinutes,
  isLiveFresh,
  pickFreshest,
  seenJourneyIds,
  siriBool,
} from "./live.js?v=84";
import { LINE_QUAYS, firstKnownQuay } from "./plan.js?v=84";
import { activityTime } from "./status.js?v=84";

export const ENTUR_CLIENT = "teitrand-fergeruter";
export const ENTUR_JOURNEY_URL = "https://api.entur.io/journey-planner/v3/graphql";
export const LIVE_VM_URLS = {
  1136: "https://api.entur.io/realtime/v1/rest/vm?datasetId=MOR&LineRef=MOR:Line:1136",
  1135: "https://api.entur.io/realtime/v1/rest/vm?datasetId=MOR&LineRef=MOR:Line:1135",
  1049: "https://api.entur.io/realtime/v1/rest/vm?datasetId=MOR&LineRef=MOR:Line:1049",
};
/** Minste tid mellom to sanntidskall. */
export const LIVE_MIN_INTERVAL_MS = 55 * 1000;
export const LIVE_BACKOFF_START_MS = 60 * 1000;
export const LIVE_MAX_BACKOFF_MS = 15 * 60 * 1000;
/** Spør berre frå litt før fyrste avgang til litt etter siste ankomst. */
export const LIVE_SERVICE_MARGIN_MIN = 30;
/** Turar vi har sett gå i sanntid, per dag. Berre dagen i dag blir teken vare på. */
export const SAILED_KEY = "fergeruter-sailed-v1";
export const SAILED_MAX_PER_DAY = 60;

/** Kombi spør 1136 fyrst og 1135 berre som reserve. */
export function liveFetchUrls(mode) {
  if (mode === "1135") return [LIVE_VM_URLS[1135]];
  if (mode === "1136") return [LIVE_VM_URLS[1136]];
  if (mode === "1049") return [LIVE_VM_URLS[1049]];
  return [LIVE_VM_URLS[1136], LIVE_VM_URLS[1135]];
}

/** Fyrste avgang til siste ankomst i minutt, eller null utan turar. */
export function serviceWindowMinutes(legs) {
  if (!legs?.length) return null;
  let start = Infinity;
  let end = 0;
  for (const leg of legs) {
    start = Math.min(start, clockMinutes(leg.departure));
    end = Math.max(end, clockMinutes(leg.arrival || leg.departure));
  }
  return { start, end };
}

/**
 * Om det er tid for å spørje Entur: innanfor driftsvindauget (`legs` er turane
 * den dagen `nowMs` gjeld) og ikkje i backoff etter feil.
 */
export function shouldFetchLive(legs, nowMs, blockedUntil = 0) {
  if (nowMs < (blockedUntil || 0)) return false;
  const win = serviceWindowMinutes(legs);
  if (!win) return false;
  const minutes = nowMinutes(nowMs);
  return minutes >= win.start - LIVE_SERVICE_MARGIN_MIN && minutes <= win.end + LIVE_SERVICE_MARGIN_MIN;
}

/** Dobla ventetid etter feil, frå 1 til 15 minutt. */
export function liveBackoff(previousMs, nowMs) {
  const backoffMs = Math.min(LIVE_MAX_BACKOFF_MS, (previousMs || LIVE_BACKOFF_START_MS / 2) * 2);
  return { backoffMs, blockedUntil: nowMs + backoffMs };
}

/** Siste VM-aktivitet som objekt appen brukar. `quays` er kaiane vi kjenner att. */
export function parseVehicleMonitoring(data, quays = LINE_QUAYS) {
  const deliveries = data?.Siri?.ServiceDelivery?.VehicleMonitoringDelivery;
  const list = Array.isArray(deliveries) ? deliveries : deliveries ? [deliveries] : [];
  const activities = [];
  for (const delivery of list) {
    const items = delivery?.VehicleActivity;
    if (!items) continue;
    activities.push(...(Array.isArray(items) ? items : [items]));
  }
  if (!activities.length) return null;
  // Entur kan sende ei gammal aktivitet (t.d. 08:00-turen) før den ferske. Bruk den nyaste.
  const activity = activities.reduce((best, item) => (activityTime(item) > activityTime(best) ? item : best));
  const journey = activity.MonitoredVehicleJourney || {};
  const location = journey.VehicleLocation || {};
  const call = journey.MonitoredCall || {};
  const framed = journey.FramedVehicleJourneyRef || {};
  const quay = (value) => firstKnownQuay(unwrapSiri(value), quays);
  return {
    destination: quay(journey.DestinationName),
    direction: quay(journey.DirectionName),
    delayMinutes: delayMinutes(journey.Delay),
    latitude: location.Latitude ?? location.latitude,
    longitude: location.Longitude ?? location.longitude,
    monitored: journey.Monitored,
    journeyRef: serviceJourneyId(framed.DatedVehicleJourneyRef),
    atStop: siriBool(call.VehicleAtStop),
    stopName: quay(call.StopPointName),
    actualDeparture: unwrapSiri(call.ActualDepartureTime),
    actualArrival: unwrapSiri(call.ActualArrivalTime),
    expectedArrival: unwrapSiri(call.ExpectedArrivalTime),
    aimedArrival: unwrapSiri(call.AimedArrivalTime),
    originAimed: unwrapSiri(journey.OriginAimedDepartureTime),
    validUntil: activity.ValidUntilTime,
    recordedAt: activity.RecordedAtTime || activity.ValidUntilTime,
  };
}

/** Eitt VM-kall. 429 og 5xx er `retryable`. */
export async function fetchVehicleMonitoring(fetchImpl, url, quays) {
  const response = await fetchImpl(url, {
    headers: { "ET-Client-Name": ENTUR_CLIENT, Accept: "application/json" },
  });
  if (response.status === 429 || response.status >= 500) {
    const error = new Error(response.statusText);
    error.retryable = true;
    throw error;
  }
  if (!response.ok) throw new Error(response.statusText);
  return parseVehicleMonitoring(await response.json(), quays);
}

/** Kaiane (med StopPlace-id) som dagens turar går frå. */
export function cancellationStops(legs) {
  const names = new Set();
  for (const leg of legs || []) names.add(quayPlace(leg.from));
  return [...names].filter((name) => STOP_PLACES[name]);
}

/** Dagens turar frå Journey Planner: avlyste, sette og faktiske avgangar. */
export async function fetchDayJourneys(fetchImpl, stops, start = osloDayStartIso()) {
  if (!stops.length) return { cancelled: new Set(), seen: new Set(), actualDepartures: new Map() };
  const response = await fetchImpl(ENTUR_JOURNEY_URL, {
    method: "POST",
    headers: { "ET-Client-Name": ENTUR_CLIENT, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: cancellationQuery(stops), variables: { start } }),
  });
  if (!response.ok) throw new Error(response.statusText);
  const payload = await response.json();
  if (payload?.errors && !payload.data) throw new Error("Entur");
  return {
    cancelled: cancelledJourneyIds(payload),
    seen: seenJourneyIds(payload),
    actualDepartures: actualDeparturesFromPayload(payload),
  };
}

/**
 * Hentar sanntid og dagens turar samstundes, slik appen gjer kvart minutt.
 * Kastar aldri. Svaret seier kva som lukkast:
 * - `live`: nyaste posisjon (null = Entur har ingen), eller undefined når kallet feila
 *   utan svar (behald den førre)
 * - `liveError`: feilen frå VM-kallet, elles null
 * - `journeys`: { cancelled, seen, actualDepartures }, eller null når kallet feila
 * - `journeysError`: feilen frå Journey Planner, elles null
 * @param {(url: string, init?: object) => Promise<Response>} fetchImpl
 * @param {{ mode: string, todayLegs: object[], quays?: string[] }} opts
 */
export async function loadEnturEvidence(fetchImpl, { mode, todayLegs, quays }) {
  const journeysPromise = fetchDayJourneys(fetchImpl, cancellationStops(todayLegs)).then(
    (journeys) => ({ journeys, journeysError: null }),
    (journeysError) => ({ journeys: null, journeysError })
  );
  const found = [];
  let live;
  let liveError = null;
  try {
    for (const url of liveFetchUrls(mode)) {
      const item = await fetchVehicleMonitoring(fetchImpl, url, quays);
      if (item) found.push(item);
      if (found.some((entry) => isLiveFresh(entry))) break;
    }
    live = pickFreshest(found);
  } catch (error) {
    liveError = error;
    live = found.length ? pickFreshest(found) : undefined;
  }
  return { live, liveError, ...(await journeysPromise) };
}

/** Turar sanntida har vist køyrde `date`. Tom mengd når lageret manglar eller er øydelagt. */
export function readSailedJourneys(date, storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(SAILED_KEY) || "null");
    const ids = parsed?.[date];
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

/** Skriv berre `date`. Eldre dagar fell bort ved neste skriving. */
export function writeSailedJourneys(date, ids, storage) {
  try {
    if (!storage) return;
    storage.setItem(SAILED_KEY, JSON.stringify({ [date]: [...ids].slice(-SAILED_MAX_PER_DAY) }));
  } catch {
    // kvote / privat modus
  }
}

