/**
 * Grunnlaget for sanntidsdelen av statusområdet øvst: overfarten som er i gang og
 * posisjonane vi kjenner. Komponentane reknar sjølv ut framdrift og alder kvart sekund
 * (core crossingView / positionSourceView); her kjem berre turen og posisjonane.
 */
import {
  clockMs,
  currentStatus,
  fixAtQuay,
  fixBelongsTo,
  fixFromLive,
  knownQuays,
  matchCrossingLeg,
  runningLegs,
  statusFromPosition,
} from "../../../packages/core/index.js";
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
