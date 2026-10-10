/**
 * Grunnlaget for sanntidsdelen av statusområdet øvst: overfarten som er i gang og
 * posisjonane vi kjenner. Komponentane reknar sjølv ut framdrift og alder kvart sekund
 * (core crossingView / positionSourceView); her kjem berre turen og posisjonane.
 */
import {
  aisSpeed,
  bestFix,
  clockMinutes,
  clockMs,
  crossingView,
  currentStatus,
  fixAtQuay,
  fixBelongsTo,
  fixFromLive,
  knownQuays,
  matchCrossingLeg,
  runningLegs,
  statusFromPosition,
  withSpan,
} from "../../../packages/core/index.js";
import { t } from "../components/i18n.js";
import { statusView } from "./context.js";

function within(leg, nowMs, slackMs) {
  return clockMs(leg.departure, nowMs) - slackMs <= nowMs && nowMs < clockMs(leg.arrival, nowMs) + slackMs;
}

/** Turen sanntidsposisjonen viser (t.d. ei forseinka ferje), om han er i gang no og ikkje alt framme. */
function liveLeg(running, fixes, nowMs) {
  for (const fix of fixes) {
    const leg = matchCrossingLeg(running, fix, { nowMs });
    if (leg && within(leg, nowMs, 15 * 60000) && fixBelongsTo(fix, leg, nowMs) && !fixAtQuay(fix, leg.to)) return leg;
  }
  return null;
}

/** Alle målte posisjonar vi kjenner: Entur (data.live) og AIS (data.positions). Rekkefølgja avgjer core bestFix. */
export function positionFixes(data) {
  return [fixFromLive(data.live), ...(Array.isArray(data.positions) ? data.positions : [])].filter(Boolean);
}

/**
 * Kvar ferja er no: rutetabellen og Entur-beviset (currentStatus), retta av fersk AIS (statusFromPosition).
 * Éi kjelde: statuslinja (ledeModel) og «No»-raden (buildTimeline) les begge denne, så dei seier det same.
 * @param {object[]} legs   dagens turar
 * @param {object[]} [running]  runningLegs(legs, now, ev), om kalleren har dei frå før
 */
export function nowStatus(data, ctx, legs, now, ev, running = runningLegs(legs, now, ev)) {
  const status = currentStatus(legs, now, ev, statusView(ctx));
  return statusFromPosition(status, { running, fixes: positionFixes(data), quays: knownQuays(ctx), now, nowMs: Date.now() });
}

/**
 * @param {object} status   currentStatus (core), same som teksten i statuslinja kjem frå
 * @param {object[]} legs   dagens turar
 * `fixes`: alle målte posisjonar i dag: Entur (data.live) og AIS (data.positions, PositionFix frå
 * core fixFromAis, fylt av model/sanntid.js). Kva som gjeld, avgjer core bestFix: AIS > Entur > rutetabell.
 * @returns {{ crossing: { leg: object, fixes: object[] }|null, fixes: object[] }}
 */
export function liveStatus(status, legs, now, ev, data) {
  const fixes = positionFixes(data);
  // pending: AIS-svaret er ikkje komme enno; «No»-raden viser då «Hentar posisjon», ikkje «Berekna frå rutetabellen».
  const pending = Boolean(data.sanntidPending);
  if (!status?.underway) return { crossing: null, fixes, pending };
  const running = runningLegs(legs, now, ev);
  const nowMs = Date.now();
  const leg = liveLeg(running, fixes, nowMs) || running.find((item) => within(item, nowMs, 0)) || null;
  return { crossing: leg ? { leg, fixes } : null, fixes, pending };
}

/** AIS-fart (knop) til «No»-raden: berre på overfart etter statuslinja, og berre frå AIS (aisSpeed). */
export function nowSpeed(data, status, nowMs = Date.now()) {
  if (!status?.underway || status.atQuay || status.outside) return null;
  return aisSpeed(bestFix(positionFixes(data), nowMs), nowMs);
}

/**
 * Fleire ferjer om kvarandre (1069): ingen «ferja er her»-status, men «ei ferje er på veg mot X» for ein tur som går no.
 * Går fleire turar samtidig, viser vi den ferja vi har måling for (AIS per fartøy, vald per tur i core fixBelongsTo), så den
 * som kjem fyrst fram. Ingen tur i gang → null (då står berre neste avgang). Posisjonen blir aldri «utanfor ruta»: ei ferje
 * som ligg ein annan stad (reserveferja) seier ingenting om denne turen (`multi` i crossing → usePositionState).
 * @returns {{ status: object, live: { crossing: { leg: object, fixes: object[], multi: true }, fixes: object[], pending: boolean } }|null}
 */
export function multiFerryNow(legs, now, ev, data, nowMs = Date.now()) {
  const fixes = positionFixes(data);
  const going = runningLegs(legs, now, ev)
    .filter((leg) => within(leg, nowMs, 0))
    .map((leg) => ({ leg, view: crossingView({ leg, fixes, nowMs, allowOutside: false }) }))
    .filter((item) => !item.view.atQuay)
    .sort((a, b) => Number(b.view.measured) - Number(a.view.measured) || clockMinutes(a.leg.arrival) - clockMinutes(b.leg.arrival));
  const leg = going[0]?.leg;
  if (!leg) return null;
  const start = clockMinutes(leg.departure);
  const text = t("status.underwayToOne", { dest: leg.to });
  const status = withSpan({ at: start + 0.5, underway: true, multi: true, text, short: text }, start, clockMinutes(leg.arrival), now);
  return { status, live: { crossing: { leg, fixes, multi: true }, fixes, pending: Boolean(data.sanntidPending) } };
}
