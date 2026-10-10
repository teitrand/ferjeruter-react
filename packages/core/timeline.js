/**
 * Tidslinja for éin dag som rein data, felles for vanilla-appen og React-skalet:
 * frå/til-filter, hendingane (avgang, venting, liggetid, tabellskifte, tomtur),
 * når ei hending er «tidlegare», og korrespondanse. Visninga lagar rader av dette.
 *
 * `filters` er `{ from, to }` (kai eller null). `ctx` er plankonteksten frå plan.js.
 */
import { t } from "../../assets/i18n.js?v=84";
import { clockMinutes, hhmm, shiftIso } from "./time.js?v=84";
import { quayPlace } from "./legs.js?v=84";
import {
  activeMode,
  activePlan,
  isCombinedTimetable,
  legsForDate,
  legsForMode,
  operationalMode,
} from "./plan.js?v=84";
import { homeQuay, isEmptyReposition, isVisibleDeparture, layoverAfter } from "./status.js?v=84";
import {
  SAEBØ,
  TRANSFER_DESTINATIONS,
  TRANSFER_MARGIN_MIN,
  asTransferTrip,
  boardingFromDest,
  cameFromDest,
  inboundConnection,
  isFerryTransfer,
  isOnwardLeg,
  isParallelFerrySplit,
  isPlannedFerrySwitch,
  journeyForLeg,
  legKey,
  outboundConnection,
  passengerJourneysFrom,
  quaysInDay,
  reachesDest,
  sortDayLegs,
  tableName,
  transferDestFromId,
  transferLineId,
} from "./timetable.js?v=84";

export const NO_FILTERS = Object.freeze({ from: null, to: null });

// --- Frå/til -------------------------------------------------------------------------------

/** Den andre ferja (1135 ↔ 1136) når ein ser på éi av dei; ikkje i kombirute. */
export function otherFerryMode(ctx) {
  if (isCombinedTimetable(ctx)) return null;
  const mode = activeMode(ctx);
  if (mode === "1135") return "1136";
  if (mode === "1136") return "1135";
  return null;
}

export function otherFerryLegs(date, ctx) {
  const other = otherFerryMode(ctx);
  return other ? legsForMode(other, date, ctx) : [];
}

/** Kaiane i frå/til-vala: dagens rute, så kaiane berre den andre ferja går til. */
export function placeFilterQuays(legs, date, ctx) {
  const seen = quaysInDay(legs);
  for (const quay of quaysInDay(otherFerryLegs(date, ctx))) {
    if (!seen.includes(quay)) seen.push(quay);
  }
  return seen;
}

/** Filter som framleis gjeld for kaiane; under to kaiar er det ingen filter. */
export function validFilters(filters, quays) {
  if (quays.length < 2) return NO_FILTERS;
  const from = filters?.from && quays.includes(filters.from) ? filters.from : null;
  const to = filters?.to && quays.includes(filters.to) ? filters.to : null;
  return from === filters?.from && to === filters?.to ? filters : { from, to };
}

/** Turane filteret ser på: med den andre ferja når filteret treng ho (overgang på Sæbø). */
export function legsForPlaceFilter(filters, date, ctx, current = legsForDate(date, ctx)) {
  if (!filters.from && !filters.to) return current;
  const extra = otherFerryLegs(date, ctx);
  if (!extra.length) return current;
  if (filters.from && filters.to) return sortDayLegs([...current, ...extra]);
  const quays = quaysInDay(current);
  const selected = [filters.from, filters.to].filter(Boolean);
  if (selected.some((quay) => !quays.includes(quay))) return sortDayLegs([...current, ...extra]);
  return current;
}

export function matchesLegPlaces(leg, filters, journeys = null) {
  if (!leg) return false;
  if (filters.from && filters.to) {
    if (journeys) return Boolean(journeyForLeg(journeys, leg));
    return quayPlace(leg.from) === filters.from && quayPlace(leg.to) === filters.to;
  }
  if (filters.from && quayPlace(leg.from) !== filters.from) return false;
  if (filters.to && quayPlace(leg.to) !== filters.to) return false;
  return true;
}

export function matchesLayover(stay, filters) {
  if (!stay) return false;
  if (filters.to) return false;
  if (filters.from) return stay.quay === filters.from;
  return true;
}

export function matchesStop(event, filters) {
  if (!filters.from && !filters.to) return true;
  if (event?.kind === "split") return false;
  if (event?.kind === "dep" && event.leg) {
    if (filters.from && filters.to) return true;
    return matchesLegPlaces(event.leg, filters);
  }
  if (event?.kind === "wait") return Boolean(filters.from && filters.to);
  if (filters.from && filters.to) return false;
  if (!event?.quays || !event.quays.length) return true;
  if (filters.from && event.quays.includes(filters.from)) return true;
  if (filters.to && event.quays.includes(filters.to)) return true;
  return false;
}

export function emptyPlaceMessage(filters) {
  if (filters.from && filters.to) return t("empty.noFromTo", { from: filters.from, to: filters.to });
  if (filters.from) return t("empty.noFrom", { from: filters.from });
  if (filters.to) return t("empty.noTo", { to: filters.to });
  return t("empty.noTripsDay");
}

// --- Hendingar -----------------------------------------------------------------------------

/** Raud merkelapp ved fyrste avgang når kombiruta tek til eller sluttar heile dagen. */
function dayStartSplit(legs, date, ctx) {
  if (!legs.length) return null;
  const plan = activePlan(date, ctx);
  if (plan.switch) return null;
  const mode = tableName(plan.mode);
  const prev = tableName(operationalMode(shiftIso(date, -1), ctx));
  if (mode === prev) return null;
  if (mode !== "kombi" && prev !== "kombi") return null;
  const first = legs.find((leg) => isVisibleDeparture(leg)) || legs[0];
  if (!first?.departure) return null;
  return {
    at: clockMinutes(first.departure),
    kind: "split",
    quays: [],
    split: { time: first.departure, quay: first.from, table: mode, before: prev, notice: null },
  };
}

/**
 * Hendingane i tidslinja (utan statusraden), i rekkjefølgja turane kjem.
 * - dep: `leg`, `journey` (frå/til med overgang), `onward`
 * - wait: venting på overgang, `stay`
 * - layover: liggetid, `stay`
 * - split: tabellskifte, `split` = { time, quay, table, before, notice }
 * - transfer: tomtur, `from`, `to`
 * Alle har `at` (minutt) og `quays`. Filtrer med matchesStop etterpå.
 */
export function timelineEvents(legs, ctx, filters = NO_FILTERS, date = ctx.date) {
  const events = [];
  const seenDep = new Set();
  const combined = isCombinedTimetable(ctx);
  const routeSwitch = activePlan(date, ctx).switch;
  const journeys = filters.from && filters.to ? passengerJourneysFrom(legs, filters.from, filters.to) : null;
  legs.forEach((leg, index) => {
    const depKey = `${leg.from}|${leg.departure}`;
    if (isVisibleDeparture(leg) && !seenDep.has(depKey)) {
      seenDep.add(depKey);
      if (matchesLegPlaces(leg, filters, journeys)) {
        const journey = journeyForLeg(journeys, leg);
        events.push({
          at: clockMinutes(leg.departure),
          kind: "dep",
          quays: [leg.from, leg.to],
          leg,
          journey,
          onward: isOnwardLeg(leg, journey),
        });
        if (journey?.wait && journey.wait.afterKey === legKey(leg)) {
          events.push({
            at: clockMinutes(journey.wait.from),
            until: clockMinutes(journey.wait.until),
            kind: "wait",
            quays: [journey.wait.quay],
            stay: journey.wait,
            onward: true,
          });
        }
      }
    }
    const next = legs[index + 1];
    const stay = layoverAfter(leg, next);
    if (stay && matchesLayover(stay, filters)) {
      events.push({ at: clockMinutes(stay.from), until: clockMinutes(stay.until), kind: "layover", quays: [stay.quay], stay });
    }
    if (next && leg.table && next.table && leg.table !== next.table) {
      // 1135 og 1136 i same tidslinje kjem frå frå/til-filteret, ikkje tabellskifte.
      if (!(isParallelFerrySplit(leg.table, next.table) && !isPlannedFerrySwitch(routeSwitch))) {
        const notice =
          routeSwitch && clockMinutes(routeSwitch.time) === clockMinutes(next.departure) ? routeSwitch.notice : null;
        events.push({
          at: clockMinutes(next.departure),
          kind: "split",
          quays: [],
          split: { time: next.departure, quay: next.from, table: next.table, before: leg.table, notice },
        });
      }
    }
    if (!combined && next && isEmptyReposition(leg.to, next.from) && (!leg.table || !next.table || leg.table === next.table)) {
      events.push({ at: clockMinutes(leg.arrival), kind: "transfer", quays: [leg.to, next.from], from: leg.to, to: next.from });
    }
  });
  const last = legs[legs.length - 1];
  const home = homeQuay(legs);
  if (!combined && last && isEmptyReposition(last.to, home)) {
    events.push({ at: clockMinutes(last.arrival), kind: "transfer", quays: [last.to, home], from: last.to, to: home });
  }
  const start = dayStartSplit(legs, date, ctx);
  if (start) events.push(start);
  return events;
}

/**
 * Når ei hending er ferdig. `skipped(leg)` seier om signalturen er «ikkje utført»
 * (då er han ferdig ved avgang). Med berre frå-filter er avgangen ferdig når ferja går.
 */
export function eventDoneAt(event, { today, filters = NO_FILTERS, skipped = () => false }) {
  if ((event.kind === "layover" || event.kind === "wait") && event.until != null) return event.until;
  if (event.kind === "arr") return event.at;
  if (event.kind !== "dep" || !event.leg) return event.at;
  const leg = event.leg;
  if (leg.signal && today && skipped(leg)) return clockMinutes(leg.departure);
  if (filters.from && !filters.to && filters.from === leg.from && leg.from !== leg.to) return clockMinutes(leg.departure);
  if (leg.arrival) return clockMinutes(leg.arrival);
  return event.at;
}

function laterEvent(events, now) {
  return events.some((item) => item.kind !== "split" && item.kind !== "status" && item.at > now);
}

/** «Tidlegare» (dempa). Statusraden er aldri tidlegare; eit tabellskifte når ingenting kjem etter. */
export function eventIsPast(event, events, now, opts) {
  if (!opts.today || event.kind === "status") return false;
  if (event.kind === "split") return !laterEvent(events, now);
  return eventDoneAt(event, opts) <= now;
}

/** Om hendinga skal visast. `status` er statusraden (liggetida han dekkjer blir gøymd). */
export function keepEvent(event, events, now, { today, showPast, status = null, ...opts }) {
  if (event.kind === "status") return true;
  if (today && status?.layover && event.kind === "layover" && event.at <= now && event.until > now) return false;
  if (!today || showPast) return true;
  if (event.kind === "split") return laterEvent(events, now);
  return eventDoneAt(event, { today, ...opts }) > now;
}

export function pastDepartureCount(events, now, opts) {
  if (!opts.today) return 0;
  return events.filter((event) => event.kind === "dep" && eventDoneAt(event, opts) <= now).length;
}

// --- Korrespondanse ------------------------------------------------------------------------

export const DEFAULT_CONNECTION_LINES = [
  { id: "solavagen", label: "Solavågen", hub: "Festøya", roadTo: "Standal" },
  { id: "hundeidvika", label: "Hundeidvika", hub: "Festøya", roadTo: "Standal" },
];

/** Stader på 1136 ein kan nå med overgang på Sæbø denne dagen. */
export function transferDestinationsFor(date, ctx) {
  const legs = legsForMode("1136", date, ctx);
  return TRANSFER_DESTINATIONS.filter((dest) =>
    legs.some(
      (leg) =>
        (quayPlace(leg.from) === SAEBØ && reachesDest(legs, leg, dest)) ||
        (quayPlace(leg.to) === SAEBØ && cameFromDest(legs, leg, dest))
    )
  );
}

/** Korrespondanse-vala: overgang til den andre ferja, så bussar/ferjer frå korrespondanse.json. */
export function visibleConnectionLines(legs, connections, date, ctx) {
  // 1049 Festøya–Hundeidvik har ingen korrespondanse (Hjørundfjord-bussar og overgang på Sæbø gjeld ikkje der).
  if (activeMode(ctx) === "1049") return [];
  const quays = quaysInDay(legs);
  const lines = [];
  const other = otherFerryMode(ctx);
  if (other && quays.includes(SAEBØ) && quaysInDay(legsForMode(other, date, ctx)).includes(SAEBØ)) {
    for (const dest of transferDestinationsFor(date, ctx)) {
      lines.push({ id: transferLineId(dest), label: dest, hub: SAEBØ });
    }
  }
  const road = (connections?.lines || DEFAULT_CONNECTION_LINES).filter((line) => {
    if (line.id === "oye" || line.hub === "Leknes" || line.roadTo === "Leknes") return false;
    const dest = line.roadTo || connections?.roadTo;
    return !dest || quays.includes(dest);
  });
  return lines.concat(road);
}

function ferryTransferIndex(connection, date, ctx) {
  const dest = transferDestFromId(connection);
  const other = otherFerryMode(ctx);
  if (!other || !dest) return null;
  const otherLegs = legsForMode(other, date, ctx);
  const toHub =
    other === "1136"
      ? otherLegs
          .filter((leg) => quayPlace(leg.to) === SAEBØ && cameFromDest(otherLegs, leg, dest))
          .map((leg) => {
            const board = boardingFromDest(otherLegs, leg, dest) || leg;
            return asTransferTrip(leg, {
              from: dest,
              to: SAEBØ,
              departure: board.departure,
              arrival: leg.arrival,
              signal: board.signal || leg.signal,
            });
          })
      : otherLegs
          .filter((leg) => quayPlace(leg.to) === SAEBØ)
          .map((leg) => asTransferTrip(leg, { from: leg.from, to: SAEBØ, signal: leg.signal }));
  const fromHub =
    other === "1136"
      ? otherLegs
          .filter((leg) => quayPlace(leg.from) === SAEBØ && reachesDest(otherLegs, leg, dest))
          .map((leg) =>
            asTransferTrip(leg, { from: SAEBØ, to: dest, departure: leg.departure, arrival: leg.arrival, signal: leg.signal })
          )
      : otherLegs
          .filter((leg) => quayPlace(leg.from) === SAEBØ)
          .map((leg) => asTransferTrip(leg, { from: SAEBØ, to: leg.to, signal: leg.signal }));
  return {
    hub: SAEBØ,
    roadTo: SAEBØ,
    buffer: TRANSFER_MARGIN_MIN,
    ferry: true,
    dest,
    other,
    view: activeMode(ctx),
    toHub: toHub.sort((a, b) => a.arrival.localeCompare(b.arrival)),
    fromHub: fromHub.sort((a, b) => a.departure.localeCompare(b.departure)),
  };
}

/** Oppslaget connectionNote brukar, eller null utan val (eller utan korrespondanse.json). */
export function connectionIndex(connection, connections, date, ctx) {
  if (!connection) return null;
  if (isFerryTransfer(connection)) return ferryTransferIndex(connection, date, ctx);
  if (!connections) return null;
  const line = connections.lines.find((candidate) => candidate.id === connection);
  if (!line) return null;
  const hub = line.hub || connections.hub;
  const roadTo = line.roadTo || connections.roadTo;
  const drive = line.driveMinutes ?? connections.driveMinutes ?? 0;
  const margin = line.marginMinutes ?? connections.marginMinutes ?? 0;
  const runsToday = (trip) => (connections.calendars[trip.cal] || []).includes(date);
  const trips = line.trips.filter(runsToday);
  return {
    hub,
    roadTo,
    buffer: drive + margin,
    toHub: trips.filter((trip) => trip.to === hub).sort((a, b) => a.arrival.localeCompare(b.arrival)),
    fromHub: trips.filter((trip) => trip.from === hub).sort((a, b) => a.departure.localeCompare(b.departure)),
  };
}

function withConnectionSignal(base, trip, index, phoneFor) {
  if (!trip?.signal || !index.other) return base;
  const phone = phoneFor(trip);
  const extra = phone
    ? t("conn.signalCallPhone", { route: index.other, phone })
    : t("conn.signalCall", { route: index.other });
  return `${base}. ${extra}`;
}

/**
 * Teksten om korrespondanse under ei avgang (`kind` «dep») eller ankomst («arr»), eller null.
 * `phoneFor(trip)` gjev nummeret for ein signaltur på den andre ferja.
 */
export function connectionNote(index, kind, leg, ctx, phoneFor = () => "", date = ctx.date) {
  if (!index) return null;
  const quay = quayPlace(kind === "dep" ? leg.from : leg.to);
  if (quay !== index.roadTo) return null;
  if (index.dest && index.view === "1136") {
    const own = legsForMode("1136", date, ctx);
    if (kind === "dep") {
      if (!reachesDest(own, leg, index.dest)) return null;
    } else if (!cameFromDest(own, leg, index.dest)) return null;
  }
  if (kind === "dep") {
    const trip = inboundConnection(index, leg.departure);
    return trip
      ? withConnectionSignal(t("conn.takeFerry", { time: hhmm(trip.departure), from: trip.from }), trip, index, phoneFor)
      : t("conn.noInbound", { hub: index.hub });
  }
  const trip = outboundConnection(index, leg.arrival);
  return trip
    ? withConnectionSignal(t("conn.onward", { time: hhmm(trip.departure), hub: index.hub, to: trip.to }), trip, index, phoneFor)
    : t("conn.noOutbound", { hub: index.hub });
}

/** Fotnoten om korrespondanse (køyretid og margin), eller "". */
export function connectionFootnote(connection, connections) {
  const dest = transferDestFromId(connection);
  if (dest) return t("conn.transferNote", { dest, margin: TRANSFER_MARGIN_MIN });
  if (!connection || !connections) return "";
  const line = connections.lines?.find((candidate) => candidate.id === connection);
  return t("conn.note", {
    drive: line?.driveMinutes ?? connections.driveMinutes,
    hub: line?.hub ?? connections.hub,
    roadTo: line?.roadTo ?? connections.roadTo,
    margin: line?.marginMinutes ?? connections.marginMinutes,
  });
}
