/**
 * Tidslinja for éin dag som rein data: kva rader som skal visast og kva dei seier.
 * Hendingane, frå/til-filteret, «tidlegare» og korrespondansen kjem frå
 * packages/core/timeline.js, same som i vanilla-appen. Her blir dei til rader med
 * status (tripStatus) og ferdige tekstar; komponentane gjer berre om til JSX.
 */
import {
  NO_FILTERS,
  activeMode,
  bookingDeadline,
  compareTimelineEvents,
  connectionIndex,
  connectionNote,
  crossesArea,
  departureStateKey,
  departureStateText,
  durationText,
  emptyPlaceMessage,
  eventIsPast,
  hasPassed,
  hhmm,
  isMultiFerryRoute,
  journeyNote,
  keepEvent,
  legsForDate,
  legsForPlaceFilter,
  matchesStop,
  minutesLeft,
  minutesToClock,
  nowMinutes,
  pastDepartureCount,
  signalObservedAtQuay,
  signalPhone,
  statusProgress,
  timelineEvents,
  tripStatus,
} from "../../../packages/core/index.js";
import { planContext, statusEvidence } from "./context.js";
import { multiFerryNow, nowStatus } from "./crossing.js";

/**
 * @typedef {object} DepartureRow
 * @property {"dep"} kind
 * @property {string} key
 * @property {boolean} past
 * @property {boolean} onward     vidare etter overgang (frå/til)
 * @property {string} time       hh:mm
 * @property {string} from
 * @property {string} to
 * @property {object} leg         turen, til detaljvindauget
 * @property {string|null} arrival  hh:mm, eller null
 * @property {boolean} cancelled
 * @property {boolean} skipped    signaltur «ikkje utført»
 * @property {"onRequest"|"booked"|null} tag
 * @property {string} phone
 * @property {{ time: string, phone: string, left: string|null, expired: boolean }|null} signalNote
 * @property {boolean} stillAtQuay
 * @property {string|null} via    overgang med frå/til (t.d. «Byt til 1135 på Sæbø»)
 * @property {string[]} notes     korrespondanse, ferdig omsett
 * @property {"cancelled"|"notRunning"|"unknown"|"gone"|"countdown"|""} state
 * @property {string} stateText  ferdig omsett tekst for kolonna til høgre (core departureStateText)
 */

function departureRow(event, status, ctx, ev, now, { today, showArrivals, index }) {
  const leg = event.leg;
  const departed = today && hasPassed(leg.departure);
  const skipped = status.verdict === "skipped";
  const phone = leg.signal ? signalPhone(leg, ctx) : "";
  let signalNote = null;
  if (leg.signal && !status.booked && !skipped && !status.sailed && !status.cancelled) {
    const deadline = bookingDeadline(leg);
    if (deadline != null) {
      const clock = `${minutesToClock(deadline)}:00`;
      const open = today && !hasPassed(clock);
      signalNote = {
        time: minutesToClock(deadline),
        phone,
        left: open ? durationText(minutesLeft(clock)) : null,
        expired: today && !open && !hasPassed(leg.departure),
      };
    }
  }
  const notes = [];
  const via = status.cancelled ? null : journeyNote(leg, event.journey) || null;
  if (!status.cancelled) {
    const phoneFor = (trip) => signalPhone(trip, ctx);
    for (const kind of ["dep", "arr"]) {
      const note = connectionNote(index, kind, leg, ctx, phoneFor);
      if (note) notes.push(note);
    }
  }
  return {
    kind: "dep",
    key: `dep|${leg.from}|${leg.departure}|${leg.table || ""}`,
    onward: event.onward,
    time: hhmm(leg.departure),
    from: leg.from,
    to: leg.to,
    leg,
    arrival: showArrivals && leg.arrival ? hhmm(leg.arrival) : null,
    cancelled: status.cancelled,
    skipped,
    tag: leg.signal && !skipped && !status.sailed ? (status.booked ? "booked" : "onRequest") : null,
    phone,
    signalNote,
    stillAtQuay: !status.cancelled && signalObservedAtQuay(leg, ev.live, now, null, ev),
    via,
    notes,
    departed,
  };
}

const NONE = { empty: null, rows: [], pastCount: 0, remember: [], emptyPlace: null };

/**
 * @param {import("./context.js").AppData} data
 * @param {import("./context.js").UiState} ui
 * @param {import("./context.js").Memory} memory
 * Les minnet, men endrar det ikkje: det tripStatus ber appen hugse, kjem i `remember`,
 * og App legg det inn i ein effekt etter teikninga (rememberBookings i context.js).
 * `emptyPlace` er teksten når frå/til ikkje gjev nokon avgang.
 * @returns {{ empty: string|null, rows: object[], pastCount: number, remember: object[], emptyPlace: string|null }}
 */
export function buildTimeline(data, ui, memory, { now = nowMinutes(), showArrivals = !ui.hideArrivals } = {}) {
  if (!data.routes && !data.kombirute) return { ...NONE, empty: "empty.noTimetable" };
  const ctx = planContext(data, ui);
  const today = ctx.date === ctx.today;
  const dayLegs = legsForDate(ctx.date, ctx);
  if (!dayLegs.length) return { ...NONE, empty: "empty.noTripsDay" };
  const filters = ui.filters || NO_FILTERS;
  const ev = statusEvidence(data, ui, memory, ctx);
  const legs = legsForPlaceFilter(filters, ctx.date, ctx, dayLegs);
  const events = timelineEvents(legs, ctx, filters).filter((event) => matchesStop(event, filters));

  const statuses = new Map();
  const remember = [];
  for (const event of events) {
    if (event.kind !== "dep") continue;
    const status = tripStatus(event.leg, ev, now);
    if (status.remember?.id) remember.push(status.remember);
    statuses.set(event.leg, status);
  }
  // Same status som statuslinja: AIS er sanninga når ho seier noko anna enn rutetabellen.
  // Fleire ferjer om kvarandre (1069): ingen «ei ferje er her»-status, berre «ei ferje er på veg» ved den turen som går no.
  const status = !today ? null : isMultiFerryRoute(activeMode(ctx)) ? multiFerryNow(dayLegs, now, ev, data)?.status || null : nowStatus(data, ctx, dayLegs, now, ev);
  if (status) events.push({ at: status.at, kind: "status", now: status });
  events.sort(compareTimelineEvents);

  const opts = { today, filters, skipped: (leg) => statuses.get(leg)?.verdict === "skipped" };
  const index = connectionIndex(ui.connection || null, data.connections, ctx.date, ctx);
  const rows = [];
  for (const event of events) {
    if (!keepEvent(event, events, now, { ...opts, showPast: ui.showPast, status })) continue;
    const past = eventIsPast(event, events, now, opts);
    rows.push(toRow(event, past, statuses.get(event.leg), { ctx, ev, now, today, showArrivals, index, filters }));
  }
  const anyDep = events.some((event) => event.kind === "dep");
  return {
    empty: null,
    // Same dag og same rute: berre då kan ei endra status lesast opp (Timeline).
    scope: today ? `${ctx.date}|${dayLegs.length}|${dayLegs[0]?.id || ""}` : null,
    rows,
    pastCount: pastDepartureCount(events, now, opts),
    remember,
    emptyPlace: !anyDep && (filters.from || filters.to) ? emptyPlaceMessage(filters) : null,
  };
}

function toRow(event, past, status, { ctx, ev, now, today, showArrivals, index, filters }) {
  switch (event.kind) {
    case "dep": {
      const row = departureRow(event, status, ctx, ev, now, { today, showArrivals, index });
      row.past = past;
      row.state = departureStateKey(status, { past, departed: row.departed, today });
      // «Avlyst» før avgangstida, «Ikkje utført» etter (core/detail.js), som i vanilla.
      row.stateText = departureStateText(row.state, event.leg, { today, past, now });
      return row;
    }
    case "layover":
    case "wait":
      return {
        kind: event.kind,
        key: `${event.kind}|${event.stay.quay}|${event.stay.from}`,
        past,
        time: hhmm(event.stay.from),
        quay: event.stay.quay,
        duration: durationText(event.stay.minutes),
        until: hhmm(event.stay.until),
        // Med frå-filter står det berre «Liggetid», kaien er alt vald.
        named: !filters.from,
      };
    case "split":
      return {
        kind: "split",
        key: `split|${event.at}|${event.split.table}`,
        past,
        time: hhmm(event.split.time),
        quay: event.split.quay,
        table: event.split.table,
        before: event.split.before,
        notice: event.split.notice ? hhmm(event.split.notice) : null,
      };
    case "transfer":
      return {
        kind: "transfer",
        key: `transfer|${event.at}|${event.to}`,
        past,
        from: event.from,
        to: event.to,
        crossesArea: crossesArea(event.from, event.to, ctx),
      };
    case "status":
      return {
        kind: "now",
        key: "now",
        past: false,
        text: event.now.text,
        // Fersk AIS ved kai (atQuay): den vanlege grøne «live»-stilen, utan liggetid-oransje og utan framdriftsfyll. Liggetida
        // og framdrifta i ho kjem frå rutetabellen (ofte ei anna kai), så dei høyrer ikkje til når AIS har ordet.
        layover: Boolean(event.now.layover) && !event.now.atQuay,
        underway: Boolean(event.now.underway),
        progress: event.now.atQuay ? null : statusProgress(event.now.from, event.now.until, now),
      };
    default:
      throw new Error(`ukjend hending ${event.kind}`);
  }
}
