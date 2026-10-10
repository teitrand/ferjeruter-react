/** Toppen: kva rute som gjeld, og statuslinja (alltid om i dag). */
import {
  activeMode,
  countdown,
  formatDateOnly,
  formatDateTime,
  hasPassed,
  hhmm,
  isMultiFerryRoute,
  isVisibleDeparture,
  knownQuays,
  legsForDate,
  nowInfo,
  nowMinutes,
  onRequestTag,
  pickNextDeparture,
  positionNoteKey,
  routeFootnotes,
  runningLegs,
  signalLogStale,
  todayIso,
  tripStatus,
  vesselInfo,
  vesselNameForTable,
} from "../../../packages/core/index.js";
import { planContext, statusEvidence } from "./context.js";
import { liveStatus, multiFerryNow, nowSpeed, nowStatus, positionFixes } from "./crossing.js";
import { nowCardBase } from "./nowcard.js";

const CHROME = {
  1136: { title: "route.title1136", eyebrow: "eyebrow", meta: "meta.title" },
  1135: { title: "route.title1135", eyebrow: "eyebrow.1135", meta: "meta.title1135" },
  1049: { title: "route.title1049", eyebrow: "eyebrow.1049", meta: "meta.title1049" },
  1069: { title: "route.title1069", eyebrow: "eyebrow.1069", meta: "meta.title1069" },
  kombi: { title: "route.titleKombi", eyebrow: "eyebrow.kombi", meta: "meta.titleKombi" },
};

/**
 * Tittel og overtittel for eit samband før data er lasta (siste samband i dag frå
 * localStorage), så overskrifta ikkje blinkar. Utan båt; den kjem med routeChrome.
 */
export function chromeForMode(mode) {
  const keys = CHROME[mode];
  if (!keys) return null;
  return { mode, kombi: mode === "kombi", titleKey: keys.title, eyebrowKey: keys.eyebrow, metaTitleKey: keys.meta, vessel: null };
}

/** Tittel, overtittel og kombirute-merke for det sambandet som gjeld den valde dagen. */
export function routeChrome(data, ui) {
  const ctx = planContext(data, ui);
  const mode = activeMode(ctx);
  const keys = CHROME[mode] || CHROME[1136];
  const vesselName = mode === "kombi" ? vesselNameForTable(mode, ctx) : mode === "1135" ? "Geiranger" : mode === "1049" ? "Dryna" : null;
  const vessel = vesselName ? vesselInfo(vesselName, ctx) : null;
  return {
    mode,
    kombi: mode === "kombi",
    titleKey: keys.title,
    eyebrowKey: keys.eyebrow,
    metaTitleKey: keys.meta,
    vessel: vessel ? { name: vessel.name, phone: vessel.phone || "" } : null,
  };
}

const NO_INFO = { lines: [], leg: null, legKind: null, legAhead: 0, legDay: null };

/**
 * Statuslinja øvst, som renderLedeStatus i assets/app.js.
 * @returns {{ noTrips: true } | { noTrips: false, status: string|null,
 *   next: { time: string, from: string, countdown: string, departure: string }|null,
 *   live: { crossing: object|null, fixes: object[] },
 *   logWarning: { when: string }|null }}
 */
export function ledeModel(data, ui, memory, now = nowMinutes(), { arrivalShown = false } = {}) {
  const ctx = planContext(data, ui);
  const legs = legsForDate(todayIso(), ctx);
  if (!legs.length) return { noTrips: true };
  const ev = statusEvidence(data, ui, memory, ctx);
  const running = runningLegs(legs, now, ev);
  // Fleire ferjer om kvarandre (1069): ingen «ferja ligg ved kai»-status. Berre «ei ferje er på veg» når ein tur går, og neste avgang.
  if (isMultiFerryRoute(activeMode(ctx))) {
    const upcoming = pickNextDeparture(running.filter((leg) => isVisibleDeparture(leg) && !hasPassed(leg.departure)), ev, now);
    const first = upcoming ? null : nowInfo({ status: null, legs, running, ev, nowMs: Date.now(), today: todayIso(), legsOn: (iso) => legsForDate(iso, ctx), arrivalShown: true, speedKn: null }).first;
    const going = multiFerryNow(legs, now, ev, data);
    return {
      noTrips: false,
      status: going ? going.status.short : null,
      next: upcoming
        ? { time: hhmm(upcoming.departure), from: upcoming.from, countdown: countdown(upcoming.departure), departure: upcoming.departure, tag: null }
        : first
          ? { text: first }
          : null,
      live: going ? going.live : null,
      info: null,
      card: going ? nowCardBase({ status: going.status, info: NO_INFO, live: going.live, data, quays: knownQuays(ctx) }) : null,
      logWarning: null,
    };
  }
  // AIS er sanninga: seier ferja ved kai (eller i fart) noko anna enn rutetabellen, vinn AIS.
  const status = nowStatus(data, ctx, legs, now, ev, running);
  const info = nowInfo({ status, legs, running, ev, nowMs: Date.now(), today: todayIso(), legsOn: (iso) => legsForDate(iso, ctx), arrivalShown, speedKn: nowSpeed(data, status) });
  // Neste avgang ferja kan ta (ikkje ein signaltur der fristen er ute og ingen bestilling er sett).
  const next = pickNextDeparture(running.filter((leg) => isVisibleDeparture(leg) && !hasPassed(leg.departure)), ev, now);
  const liveInfo = liveStatus(status, legs, now, ev, data);
  const stale = signalLogStale(Date.now(), data.signalLog) && legs.some((leg) => leg.signal);
  return {
    noTrips: false,
    status: status ? status.short || status.text.replace(/\.$/, "") : null,
    // Éi setning om neste avgang: i dag med nedteljing og signalmerke, elles første tur neste driftsdag.
    next: next
      ? {
          time: hhmm(next.departure),
          from: next.from,
          countdown: countdown(next.departure),
          departure: next.departure,
          tag: onRequestTag(next, { today: true, booked: tripStatus(next, ev, now).booked, now }),
        }
      : info.first
        ? { text: info.first }
        : null,
    // Sanntid under statuslinja: framdrift og ferje på overfart, elles berre kjeldemerket.
    live: liveInfo,
    // Teksten i «No»-raden: kvar ferja er, neste/fyrste tur med nedteljing, overfartstid og turen etter.
    info,
    // «No»-kortet (model/nowcard.js): kva som skal visast ved kai, på veg, utanfor ruta osv.
    card: nowCardBase({ status, info, live: liveInfo, data, quays: knownQuays(ctx) }),
    logWarning: stale ? { when: data.signalLog?.updatedAt ? formatDateTime(data.signalLog.updatedAt) : "" } : null,
  };
}

/**
 * Fotnoten under rutetabellen, som renderPositionNote() og renderRouteChrome() i
 * assets/app.js: posisjonskjelde, når rutetabellen vart henta, papirruteplan og NAIS.
 * Før rutetabellen er lasta: same standardtekstar som index.html.
 * @returns {{ position: string, updated: string|null, pdf: { href: string, text: string }, nais: string }}
 */
export function footnoteModel(data, ui, chrome) {
  const ready = Boolean(data.routes || data.kombirute);
  const quays = ready ? knownQuays(planContext(data, ui)) : [];
  return {
    // Med AIS i bruk (data.sanntidOn) nemner fotnoten berre kjelda posisjonen faktisk kjem frå.
    position: positionNoteKey(data.live, data.liveFailed, quays, data.sanntidOn ? positionFixes(data) : null),
    updated: data.routes?.fetchedAt ? formatDateOnly(data.routes.fetchedAt) : null,
    ...routeFootnotes(chrome?.mode, { kombirute: data.kombirute, vessel: chrome?.vessel }),
    // 1049 og 1069 har ingen signalturar: ingen forklaring om bestilling på telefon.
    signal: chrome?.mode !== "1049" && chrome?.mode !== "1069",
  };
}
