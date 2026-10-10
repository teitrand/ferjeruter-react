/**
 * Kva rutetabell som gjeld ein dag: valt samband, meldingar og omlegging.
 *
 * Alt les frå eit eksplisitt `ctx` i staden for global tilstand:
 * - `routes`, `kombirute`: rutetabellane (data/ruter.json og data/kombirute.json)
 * - `messages`: trafikkmeldingane
 * - `routeChoice`: sambandet brukaren har valt («1136», «1135» eller «1049»)
 * - `override`: ?rute= på testhosten, elles null
 * - `fromQuery`: omlegging frå ?frå= på testhosten, elles null
 * - `nowMs`, `today`: klokka og datoen i dag
 * - `date`: dagen brukaren ser på
 */
import {
  clockFromInstant,
  clockFromNow,
  clockMinutes,
  dayType,
  osloIsoFromInstant,
  todayIso,
} from "./time.js?v=84";
import { quayPlace } from "./legs.js?v=84";
import { driftNeedsOperationalTable, resolveRoutePlan } from "./messages.js?v=84";
import { cutBeforeSwitch, cutFromSwitch, sortDayLegs } from "./timetable.js?v=84";

export function chosenRoute(ctx) {
  return CHOOSABLE_ROUTES.has(ctx?.routeChoice) ? ctx.routeChoice : "1136";
}

export function lineLegs(mode, ctx) {
  if (mode === "kombi") return ctx?.kombirute?.legs || [];
  return ctx?.routes?.lines?.[mode]?.legs || ctx?.routes?.legs || [];
}

export function allCatalogLegs(ctx) {
  const fromLines = Object.values(ctx?.routes?.lines || {}).flatMap((line) => line.legs || []);
  return [...fromLines, ...(ctx?.routes?.legs || []), ...(ctx?.kombirute?.legs || [])];
}

export function legsForMode(mode, date, ctx) {
  const tagged =
    mode === "kombi"
      ? lineLegs("kombi", ctx)
          .filter((leg) => (leg.days || []).includes(dayType(date)))
          .map((leg) => ({ ...leg, table: "kombi" }))
      : lineLegs(mode, ctx)
          .filter((leg) => (leg.activeDates || []).includes(date))
          .map((leg) => ({ ...leg, table: mode }));
  return tagged;
}

export function quayAtStart(mode, date, time, ctx) {
  const hits = sortDayLegs(legsForMode(mode, date, ctx).filter((leg) => leg.departure === time));
  return hits[0] ? quayPlace(hits[0].from) : null;
}

export function resolveSwitch(raw, date, ctx) {
  if (!raw) return null;
  const after = raw.after;
  return {
    ...raw,
    after,
    quay: quayAtStart(after, date, raw.time, ctx),
  };
}

export function latestLocalMessage(ctx, date = ctx?.date) {
  return resolveRoutePlan(ctx?.messages, ctx?.nowMs ?? Date.now(), date).message || null;
}

/** Klokka meldinga kom. Berre same dag som tabellen gjev eit usikkert hol. */
export function resolveNotice(raw, date, ctx) {
  if (raw?.notice) return raw.notice;
  if (raw?.acute === true) return date === (ctx?.today ?? todayIso()) ? clockFromNow() : "00:00:00";
  if (raw?.acute === false) return null;
  const latest = latestLocalMessage(ctx);
  const iso = latest?.publishedAt || latest?.validFrom;
  if (!iso || osloIsoFromInstant(iso) !== date) return null;
  return clockFromInstant(iso);
}

export function operationalMode(date, ctx) {
  return resolveRoutePlan(ctx?.messages, ctx?.nowMs ?? Date.now(), date).mode || "1136";
}

export function applySwitchPlan(mode, parsed, date, ctx) {
  if (!parsed || (parsed.after || mode) !== mode) {
    return { mode, switch: null, notice: null, uncertain: false };
  }
  const routeSwitch = resolveSwitch(parsed, date, ctx);
  const notice = resolveNotice(parsed, date, ctx);
  return {
    mode: routeSwitch.after || mode,
    switch: { ...routeSwitch, notice },
    notice,
    uncertain: Boolean(notice && clockMinutes(notice) < clockMinutes(routeSwitch.time)),
  };
}

/** 1049 Festøya–Hundeidvik er eit eige samband med eiga ferje: trafikkmeldingane styrer ikkje tabellen (ingen kombirute). */
const INDEPENDENT_ROUTES = new Set(["1049"]);

export function activePlan(date, ctx) {
  const own = ctx?.override || chosenRoute(ctx);
  if (INDEPENDENT_ROUTES.has(own)) return { mode: own, switch: null, notice: null, uncertain: false };
  const fromQuery = ctx?.fromQuery || null;
  const resolved = resolveRoutePlan(ctx?.messages, ctx?.nowMs ?? Date.now(), date);
  const override = ctx?.override || null;
  const parsed = fromQuery || resolved.switch;
  if (override) {
    const forOverride = parsed && (parsed.after || override) === override ? parsed : null;
    return applySwitchPlan(override, forOverride, date, ctx);
  }
  if (driftNeedsOperationalTable(resolved, parsed)) {
    const mode = (fromQuery ? fromQuery.after : resolved.mode) || "1136";
    return applySwitchPlan(mode, parsed, date, ctx);
  }
  return { mode: chosenRoute(ctx), switch: null, notice: null, uncertain: false };
}

export function activeMode(ctx) {
  return ctx?.override || activePlan(ctx?.date, ctx).mode || "1136";
}

export function legsForDate(date, ctx) {
  const plan = activePlan(date, ctx);
  const after = legsForMode(plan.mode, date, ctx);
  if (!plan.switch) return sortDayLegs(after);
  const fromAfter = cutFromSwitch(after, plan.switch);
  const before = cutBeforeSwitch(
    legsForMode(plan.switch.before, date, ctx),
    plan.switch,
    plan.notice
  );
  return sortDayLegs([...before, ...fromAfter]);
}

/**
 * Éi ferje køyrer både 1135 og 1136 som éi tabell. PDF-en har òg
 * signalturar som overlappar i klokka (t.d. Skår og Leknes samstundes).
 * Då er «flyttar seg utan passasjerar» ikkje ei ekte forflytting.
 */
export function isCombinedTimetable(ctx, date = ctx?.date) {
  const plan = activePlan(date, ctx);
  return plan.mode === "kombi" || Boolean(plan.switch);
}

export function hjorundfjordQuays(ctx) {
  return ctx?.routes?.hjorundfjordQuays || [];
}

export function crossesArea(from, to, ctx) {
  const inside = hjorundfjordQuays(ctx);
  if (!inside.length) return false;
  return inside.includes(from) !== inside.includes(to);
}

export const LINE_QUAYS = [
  "Store Kalvøy",
  "Valderøya",
  "Standal",
  "Trandal",
  "Sæbø",
  "Skår",
  "Leknes",
  "Bjørke",
  "Urke",
  "Hundeidvik",
  "Festøya",
];

export function knownQuays(ctx) {
  const names = new Set(LINE_QUAYS);
  for (const quay of hjorundfjordQuays(ctx)) names.add(quay);
  for (const leg of allCatalogLegs(ctx)) {
    names.add(leg.from);
    names.add(leg.to);
  }
  return [...names].filter(Boolean);
}

/** Entur kan sende heile resten av turen, t.d. «Sæbø Trandal Standal». */
export function firstKnownQuay(name, quays = LINE_QUAYS) {
  const text = quayPlace(name);
  if (!text) return "";
  const known = [...quays].sort((a, b) => b.length - a.length);
  for (const quay of known) {
    if (text === quay || text.startsWith(`${quay} `)) return quay;
  }
  return text;
}

export const ALLOWED_MODES = new Set(["1136", "1135", "1049", "kombi"]);

export const CHOOSABLE_ROUTES = new Set(["1136", "1135", "1049"]);
