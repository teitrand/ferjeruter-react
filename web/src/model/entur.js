/**
 * Entur-bevis i React-skalet: når vi skal spørje, korleis svaret blir tilstand, og
 * kva appen skal hugse etterpå. Sjølve kalla og reglane ligg i packages/core/entur.js,
 * felles med vanilla-appen.
 */
import {
  LIVE_MIN_INTERVAL_MS,
  activeMode,
  bookingsSeenInFeed,
  legsForDate,
  liveBackoff,
  liveSailedJourneyId,
  nowMinutes,
  osloIsoFromMs,
  shouldFetchLive,
  todayIso,
} from "../../../packages/core/index.js";
import { planContext, statusEvidence } from "./context.js";

/**
 * @typedef {object} EnturState
 * @property {object|null} live            nyaste VM-posisjon
 * @property {boolean} liveFailed          siste VM-kall feila (for fotnoten om posisjon)
 * @property {Set<string>} cancelledJourneys
 * @property {Map<string,string>} actualDepartures
 * @property {number} journeysAt           når Journey Planner sist svara (ms), 0 = aldri
 * @property {number} fetchedAt            når vi sist spurde (ms)
 * @property {number} answeredAt           når kallet bak gjeldande svar starta (ms), 0 = ingen svar
 * @property {number} backoffMs
 * @property {number} blockedUntil
 */

/** @returns {EnturState} */
export function emptyEntur() {
  return {
    live: null,
    liveFailed: false,
    cancelledJourneys: new Set(),
    actualDepartures: new Map(),
    journeysAt: 0,
    fetchedAt: 0,
    answeredAt: 0,
    backoffMs: 0,
    blockedUntil: 0,
  };
}

/** Ui for i dag: sanntid og avlysingar gjeld alltid dagen i dag, same kva dag som er vald. */
function todayUi(ui) {
  return { ...ui, date: null };
}

/** Sambandet sanntida skal spørje etter (i dag). */
export function enturMode(data, ui) {
  return activeMode(planContext(data, todayUi(ui)));
}

/** Om det er tid for nytt kall: driftsvindauge, backoff og minst 55 s sidan sist. */
export function enturDue(entur, data, ui, nowMs = Date.now(), hidden = false) {
  if (hidden || (!data.routes && !data.kombirute)) return false;
  if (nowMs - entur.fetchedAt < LIVE_MIN_INTERVAL_MS) return false;
  return shouldFetchLive(legsForDate(todayIso(), planContext(data, todayUi(ui))), nowMs, entur.blockedUntil);
}

/** Argumenta til loadEnturEvidence i core. */
export function enturRequest(data, ui, quays) {
  const ctx = planContext(data, todayUi(ui));
  return { mode: activeMode(ctx), todayLegs: legsForDate(todayIso(), ctx), quays };
}

/**
 * Reduceren for Entur-tilstanden.
 * - `start`: kall sendt (`at`)
 * - `loaded`: svar frå loadEnturEvidence (`result`, `at`, `startedAt` = når kallet starta).
 *   Eit svar frå eit kall som starta før det vi alt har, blir kasta (eit treigt kall
 *   skal ikkje skrive over eit nyare svar).
 * - `reset`: anna samband, så den gamle posisjonen gjeld ikkje (og spør med ein gong)
 */
export function enturReducer(state, action) {
  switch (action.type) {
    case "start":
      return { ...state, fetchedAt: action.at };
    case "reset":
      return { ...state, live: null, fetchedAt: 0 };
    case "loaded": {
      const { result, at } = action;
      const startedAt = action.startedAt ?? at;
      if (startedAt < state.answeredAt) return state;
      const next = { ...state, answeredAt: startedAt };
      if (result.live !== undefined) next.live = result.live;
      if (result.liveError) {
        const backoff = liveBackoff(state.backoffMs, at);
        Object.assign(next, { liveFailed: true, backoffMs: backoff.backoffMs, blockedUntil: backoff.blockedUntil });
      } else {
        Object.assign(next, { liveFailed: false, backoffMs: 0, blockedUntil: 0 });
      }
      if (result.journeys) {
        next.cancelledJourneys = result.journeys.cancelled;
        next.actualDepartures = result.journeys.actualDepartures;
        next.journeysAt = at;
      }
      return next;
    }
    default:
      throw new Error(`ukjend handling ${action.type}`);
  }
}

/**
 * Data for modellen: det som er lasta, pluss Entur-bevisa.
 * Utan nett (`offline`) har vi ikkje kontakt med Entur, same om det siste kallet gjekk bra,
 * eller om vi ikkje har spurt (utanfor driftstida, før fyrste kall). Då seier fotnoten
 * «Fekk ikkje kontakt med Entur», ikkje «Entur har ingen posisjon».
 */
export function withEntur(data, entur, { offline = false } = {}) {
  return {
    ...data,
    live: entur.live,
    liveFailed: entur.liveFailed || offline,
    cancelledJourneys: entur.cancelledJourneys,
    actualDepartures: entur.actualDepartures,
  };
}

/**
 * Det appen skal hugse etter eit Entur-svar (køyrer i ein effekt, ikkje under teikning):
 * - turen sanntida viser at ferja køyrde (lagra for resten av dagen)
 * - signalturar Entur har faktisk avgang for (bestilt), og gløym avlyste
 * Returnerer true når minnet endra seg.
 * @param {import("./context.js").Memory} memory
 */
export function rememberEntur(memory, data, ui, entur, now = nowMinutes()) {
  const today = todayIso();
  const evData = withEntur(data, entur);
  const ev = statusEvidence(evData, todayUi(ui), memory);
  let changed = false;
  const sailedId = liveSailedJourneyId(entur.live, now, ev);
  if (sailedId) changed = memory.rememberSailed(today, sailedId) || changed;
  for (const id of entur.cancelledJourneys) changed = memory.confirmedBooked.delete(id) || changed;
  if (entur.journeysAt && osloIsoFromMs(entur.journeysAt) === today) {
    for (const id of bookingsSeenInFeed(ev.dayLegs, now, ev)) {
      if (!memory.confirmedBooked.has(id)) {
        memory.confirmedBooked.add(id);
        changed = true;
      }
    }
  }
  return changed;
}

