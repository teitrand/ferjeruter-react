/**
 * Kontrollane over tidslinja (frå/til, ankomsttider, korrespondanse), trafikkmelding-
 * panelet og detaljvindauget, som rein data. Reglane ligg i packages/core.
 */
import {
  NO_FILTERS,
  activeMode,
  chosenRoute,
  connectionFootnote,
  departureDetail,
  departureDetailContent,
  clockMs,
  fixForLeg,
  fixFreshness,
  isMultiFerryRoute,
  vesselNameForTable,
  legsForDate,
  messagesPanel,
  nowMinutes,
  placeFilterQuays,
  signalPhone,
  tripStatus,
  validFilters,
  visibleConnectionLines,
} from "../../../packages/core/index.js";
import { isTodaySelected, planContext, statusEvidence } from "./context.js";
import { positionFixes } from "./crossing.js";
import { ferryName } from "./ferries.js";

/**
 * Frå/til-vala for den valde dagen. `filters` er det som faktisk gjeld (val for kaiar
 * som ikkje finst denne dagen, fell bort). Tomt `quays` = ingen filter å vise.
 */
export function placeFilterModel(data, ui) {
  const ctx = planContext(data, ui);
  const quays = placeFilterQuays(legsForDate(ctx.date, ctx), ctx.date, ctx);
  const filters = validFilters(ui.filters || NO_FILTERS, quays);
  if (quays.length < 2) return { quays: [], filters, from: [], to: [], canSwap: false };
  return {
    quays,
    filters,
    from: quays.filter((quay) => quay !== filters.to),
    to: quays.filter((quay) => quay !== filters.from),
    canSwap: Boolean(filters.from || filters.to),
  };
}

/** Korrespondanse-vala og fotnoten. `value` er null når valet ikkje gjeld denne dagen. */
export function connectionModel(data, ui) {
  const ctx = planContext(data, ui);
  const lines = visibleConnectionLines(legsForDate(ctx.date, ctx), data.connections, ctx.date, ctx);
  const value = ui.connection && lines.some((line) => line.id === ui.connection) ? ui.connection : null;
  return { lines, value, footnote: connectionFootnote(value, data.connections) };
}

/**
 * Det UI-tilstanden må gløyme fordi det ikkje gjeld lenger (som vanilla-appen gjer når
 * han teiknar), eller null. App sender det som «sanitize» i ein effekt.
 */
export function staleChoices(ui, place, connection, panel) {
  const patch = {};
  const filters = ui.filters || NO_FILTERS;
  if (place.filters.from !== filters.from || place.filters.to !== filters.to) patch.filters = place.filters;
  if (connection.value !== ui.connection) patch.connection = connection.value;
  if (panel && !panel.hidden && panel.filter !== ui.messageFilter) patch.messageFilter = panel.filter;
  return Object.keys(patch).length ? patch : null;
}

/** Trafikkmelding-panelet for det valde sambandet. */
export function messagesModel(data, ui, nowMs = Date.now()) {
  return messagesPanel(data.messages, ui.messageFilter, chosenRoute(ui), nowMs);
}

/**
 * Ferja på turen, berre når vi veit det (aldri gjetta): 1069 har fleire ferjer, så der kjem namnet frå AIS-posisjonen som høyrer
 * til akkurat denne turen (same val som overfarten), og berre medan turen går. Elles er det ferja som køyrer tabellen (1136, 1135,
 * 1049; kombiruta frå meldinga). Ukjend = null, og linja blir utelaten.
 * @returns {{ name: string, source: "ais"|"table", state?: string }|null}
 */
export function detailFerry(data, ui, ctx, leg, nowMs = Date.now()) {
  const mode = activeMode(ctx);
  if (isMultiFerryRoute(mode)) {
    if (!isTodaySelected(ui) || nowMs < clockMs(leg.departure, nowMs) || nowMs > clockMs(leg.arrival, nowMs)) return null;
    const fix = fixForLeg(positionFixes(data).filter((item) => item.source === "ais"), leg, nowMs);
    const state = fix ? fixFreshness(fix, nowMs) : null;
    const name = fix && state !== "unknown" ? ferryName(fix) : "";
    return name ? { name, source: "ais", state } : null;
  }
  const table = leg.table || mode;
  const name = table === "1049" ? "Dryna" : vesselNameForTable(table, ctx);
  return name ? { name: String(name).replace(/^M\/F\s+/i, ""), source: "table" } : null;
}

/** Detaljvindauget for `leg`, med status no. */
export function detailModel(data, ui, memory, leg, now = nowMinutes(), nowMs = Date.now()) {
  if (!leg) return null;
  const ctx = planContext(data, ui);
  const status = tripStatus(leg, statusEvidence(data, ui, memory, ctx), now);
  const detail = departureDetail(leg, status, status.signal ? signalPhone(leg, ctx) : "");
  return departureDetailContent(leg, detail, { today: isTodaySelected(ui), now, ferry: detailFerry(data, ui, ctx, leg, nowMs) });
}
