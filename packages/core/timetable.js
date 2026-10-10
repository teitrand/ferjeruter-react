/**
 * Rutetabell: dagar, legg, korrespondanse og samanhengande turar.
 * Rein logikk utan DOM, flytta uendra frå assets/app.js.
 */
import { t } from "../../assets/i18n.js?v=84";
import { clockMinutes, hhmm } from "./time.js?v=84";
import { LAYOVER_MIN_MINUTES, isUncertainDeparture, quayPlace } from "./legs.js?v=84";

export function cutBeforeSwitch(legs, routeSwitch, notice = null) {
  const at = clockMinutes(routeSwitch.time);
  return legs.filter((leg) => {
    const dep = clockMinutes(leg.departure);
    if (dep >= at) return false;
    return !isUncertainDeparture(leg.departure, notice, routeSwitch.time);
  });
}

export function cutFromSwitch(legs, routeSwitch) {
  const at = clockMinutes(routeSwitch.time);
  const quay = routeSwitch.quay ? quayPlace(routeSwitch.quay) : null;
  return legs.filter((leg) => {
    const dep = clockMinutes(leg.departure);
    if (dep > at) return true;
    if (dep < at) return false;
    return !quay || quayPlace(leg.from) === quay;
  });
}

export function sortDayLegs(legs) {
  return [...legs].sort(
    (a, b) => a.departure.localeCompare(b.departure) || a.from.localeCompare(b.from)
  );
}

export function quaysInDay(legs) {
  const seen = [];
  for (const leg of legs) {
    for (const quay of [leg.from, leg.to]) {
      if (!seen.includes(quay)) seen.push(quay);
    }
  }
  return seen;
}

/** Rutetabellen endrar seg sjeldan; hugsa sist vising så oppdatering av sida ikkje ventar på 400 KB JSON. */
export function timetableFingerprint(routes, kombirute, connections) {
  return JSON.stringify({
    routes: routes?.fetchedAt || null,
    kombi: kombirute?.source || null,
    kombiFrom: kombirute?.validFrom || null,
    conn: connections?.fetchedAt || null,
  });
}

/**
 * Turane over Storfjorden som gjeld den valde dagen, delte etter retning.
 * Reisevegen avgjer kva veg det korresponderer: skal du inn fjorden treng du
 * ei ferje som er framme på knutepunktet i tide, skal du ut treng du ei som
 * går derifrå etterpå.
 */
export const SAEBØ = "Sæbø";

export const TRANSFER_MARGIN_MIN = 5;

export const TRANSFER_DESTINATIONS = ["Trandal", "Standal", "Skår"];

export function transferLineId(dest) {
  const slug = dest === "Skår" ? "skar" : String(dest || "").toLowerCase();
  return `saebo-${slug}`;
}

export function transferDestFromId(id) {
  return TRANSFER_DESTINATIONS.find((dest) => transferLineId(dest) === id) || null;
}

export function isFerryTransfer(id) {
  return Boolean(transferDestFromId(id));
}

export function legKey(leg) {
  return leg.id || `${leg.from}|${leg.departure}|${leg.to}|${leg.arrival || ""}`;
}

export function nextSameSailing(legs, current, seen) {
  const from = quayPlace(current.to);
  const earliest = clockMinutes(current.arrival);
  let found = null;
  for (const leg of legs) {
    if (seen.has(legKey(leg))) continue;
    if (quayPlace(leg.from) !== from) continue;
    const dep = clockMinutes(leg.departure);
    const gap = dep - earliest;
    if (gap < 0 || gap >= LAYOVER_MIN_MINUTES) continue;
    if (!found || dep < clockMinutes(found.departure)) found = leg;
  }
  return found;
}

export function prevSameSailing(legs, current, seen) {
  const to = quayPlace(current.from);
  const latest = clockMinutes(current.departure);
  let found = null;
  for (const leg of legs) {
    if (seen.has(legKey(leg))) continue;
    if (quayPlace(leg.to) !== to) continue;
    const arr = clockMinutes(leg.arrival);
    const gap = latest - arr;
    if (gap < 0 || gap >= LAYOVER_MIN_MINUTES) continue;
    if (!found || arr > clockMinutes(found.arrival)) found = leg;
  }
  return found;
}

/** Går same segling vidare frå eit Sæbø-bein til destinasjonen. */
export function reachesDest(legs, start, dest) {
  if (quayPlace(start.to) === dest) return true;
  let current = start;
  const seen = new Set([legKey(start)]);
  for (let i = 0; i < 8; i++) {
    const next = nextSameSailing(legs, current, seen);
    if (!next) return false;
    seen.add(legKey(next));
    if (quayPlace(next.to) === dest) return true;
    if (quayPlace(next.to) === SAEBØ) return false;
    current = next;
  }
  return false;
}

/** Fyrste bein i same segling, der ein stig på ved destinasjonen. */
export function boardingFromDest(legs, arrival, dest) {
  if (quayPlace(arrival.from) === dest) return arrival;
  let current = arrival;
  const seen = new Set([legKey(arrival)]);
  for (let i = 0; i < 8; i++) {
    const prev = prevSameSailing(legs, current, seen);
    if (!prev) return null;
    seen.add(legKey(prev));
    if (quayPlace(prev.from) === dest) return prev;
    if (quayPlace(prev.from) === SAEBØ) return null;
    current = prev;
  }
  return null;
}

export function cameFromDest(legs, arrival, dest) {
  return Boolean(boardingFromDest(legs, arrival, dest));
}

export function tableGroup(leg) {
  return leg.table || "same";
}

export function collectSailings(legs) {
  const used = new Set();
  const sailings = [];
  for (const leg of legs) {
    const key = legKey(leg);
    if (used.has(key)) continue;
    if (prevSameSailing(legs, leg, new Set())) continue;
    const chain = [leg];
    used.add(key);
    let current = leg;
    for (let i = 0; i < 24; i++) {
      const next = nextSameSailing(legs, current, used);
      if (!next) break;
      used.add(legKey(next));
      chain.push(next);
      current = next;
    }
    sailings.push(chain);
  }
  return sailings;
}

export function rideOnSailing(chain, from, to) {
  const rides = [];
  for (let i = 0; i < chain.length; i++) {
    if (quayPlace(chain[i].from) !== from) continue;
    const slice = [];
    for (let j = i; j < chain.length; j++) {
      slice.push(chain[j]);
      const arrived = quayPlace(chain[j].to);
      if (arrived === to) {
        rides.push(slice.slice());
        break;
      }
      if (arrived === from) break;
    }
  }
  if (!rides.length) return [];
  rides.sort((a, b) => a.length - b.length || clockMinutes(a[0].departure) - clockMinutes(b[0].departure));
  const shortest = rides[0].length;
  return rides.filter((ride) => ride.length === shortest);
}

export function hubOnwardReaches(legs, start, hub, dest) {
  for (let j = start; j < legs.length; j++) {
    const arrived = quayPlace(legs[j].to);
    if (arrived === dest) return true;
    if (arrived === hub) return false;
  }
  return false;
}

export function firstHubOnwardIndex(legs, hub, dest) {
  for (let i = 0; i < legs.length; i++) {
    if (quayPlace(legs[i].from) !== hub) continue;
    if (hubOnwardReaches(legs, i, hub, dest)) return i;
  }
  return -1;
}

/** Hopp over Sæbø–Leknes-pendel; passasjeren ventar på knutepunktet. */
export function collapseHubWait(legs, hub = SAEBØ) {
  if (!legs.length) return { legs, wait: null };
  const dest = quayPlace(legs[legs.length - 1].to);
  if (dest === hub) return { legs, wait: null };
  const firstArr = legs.findIndex((leg) => quayPlace(leg.to) === hub);
  const onward = firstHubOnwardIndex(legs, hub, dest);
  if (firstArr < 0 || onward < 0 || onward <= firstArr) return { legs, wait: null };
  const arrive = legs[firstArr];
  const depart = legs[onward];
  const minutes = clockMinutes(depart.departure) - clockMinutes(arrive.arrival);
  const dropped = onward > firstArr + 1;
  if (minutes < 1) return { legs, wait: null };
  if (!dropped && minutes < LAYOVER_MIN_MINUTES) return { legs, wait: null };
  return {
    legs: [...legs.slice(0, firstArr + 1), ...legs.slice(onward)],
    wait: {
      quay: hub,
      minutes,
      from: arrive.arrival,
      until: depart.departure,
      afterKey: legKey(arrive),
    },
  };
}

export function asPassengerJourney(parts, extra = {}) {
  const collapsed = collapseHubWait(parts);
  return {
    transfer: Boolean(extra.transfer),
    hub: extra.hub,
    onwardAt: extra.onwardAt,
    legs: collapsed.legs,
    wait: collapsed.wait,
  };
}

export function sameTableJourneys(legs, from, to) {
  if (!from || !to || from === to) return [];
  return collectSailings(legs).flatMap((chain) => rideOnSailing(chain, from, to));
}

export function hubTransfers(feederLegs, onwardLegs, from, to, hub) {
  const feeders = sameTableJourneys(feederLegs, from, hub);
  const onwards = sameTableJourneys(onwardLegs, hub, to);
  const journeys = [];
  for (const onward of onwards) {
    const departHub = clockMinutes(onward[0].departure);
    const latest = departHub - TRANSFER_MARGIN_MIN;
    const candidates = feeders.filter(
      (feeder) => clockMinutes(feeder[feeder.length - 1].arrival) <= latest
    );
    if (!candidates.length) continue;
    candidates.sort(
      (a, b) =>
        clockMinutes(b[b.length - 1].arrival) - clockMinutes(a[a.length - 1].arrival)
    );
    journeys.push({
      legs: [...candidates[0], ...onward],
      transfer: true,
      hub,
      onwardAt: onward[0].departure,
    });
  }
  return journeys;
}

export function passengerJourneysFrom(legs, from, to) {
  if (!from || !to || from === to) return [];
  const groups = new Map();
  for (const leg of legs) {
    const key = tableGroup(leg);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(leg);
  }
  const tables = [...groups.values()];
  const same = tables.flatMap((group) => sameTableJourneys(group, from, to));
  if (same.length) return same.map((parts) => asPassengerJourney(parts));
  if (tables.length < 2) return [];
  const transfers = [];
  for (let i = 0; i < tables.length; i++) {
    for (let j = 0; j < tables.length; j++) {
      if (i === j) continue;
      transfers.push(...hubTransfers(tables[i], tables[j], from, to, SAEBØ));
    }
  }
  return transfers.map((journey) => asPassengerJourney(journey.legs, journey));
}

export function journeyForLeg(journeys, leg) {
  if (!journeys || !leg) return null;
  const key = legKey(leg);
  return journeys.find((journey) => journey.legs.some((part) => legKey(part) === key)) || null;
}

/** Seinare bein i same reisa. Fyrste avgang er den du faktisk tek frå filteret. */
export function isOnwardLeg(leg, journey) {
  if (!journey || journey.legs.length < 2 || !leg) return false;
  return legKey(journey.legs[0]) !== legKey(leg);
}

export function journeyNote(leg, journey) {
  if (!journey || journey.legs.length < 2) return null;
  if (legKey(journey.legs[0]) !== legKey(leg)) return null;
  const last = journey.legs[journey.legs.length - 1];
  const via = journey.legs.slice(0, -1).map((part) => quayPlace(part.to));
  if (journey.transfer) {
    return t("place.transferVia", {
      hub: journey.hub || SAEBØ,
      to: quayPlace(last.to),
      time: hhmm(journey.onwardAt),
      arrival: hhmm(last.arrival),
    });
  }
  return t("place.via", { via: via.join(", "), time: hhmm(last.arrival) });
}

export function asTransferTrip(leg, { from, to, departure, arrival, signal }) {
  return {
    from,
    to,
    departure: departure || leg.departure,
    arrival: arrival || leg.arrival,
    signal: signal === undefined ? leg.signal : signal,
    table: leg.table,
  };
}

export function inboundConnection(index, departure) {
  const latest = clockMinutes(departure) - index.buffer;
  let found = null;
  for (const trip of index.toHub) {
    if (clockMinutes(trip.arrival) <= latest) found = trip;
    else break;
  }
  return found;
}

export function outboundConnection(index, arrival) {
  const earliest = clockMinutes(arrival) + index.buffer;
  return index.fromHub.find((trip) => clockMinutes(trip.departure) >= earliest) || null;
}

export function tableName(mode) {
  if (mode === "kombi" || mode === "1135" || mode === "1136" || mode === "1049" || mode === "1069") return mode;
  return "1136";
}

export function isParallelFerrySplit(fromTable, toTable) {
  const pair = new Set([fromTable, toTable]);
  return pair.has("1135") && pair.has("1136");
}

export function isPlannedFerrySwitch(routeSwitch) {
  if (!routeSwitch) return false;
  return isParallelFerrySplit(routeSwitch.before, routeSwitch.after);
}
