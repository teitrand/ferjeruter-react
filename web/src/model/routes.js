/**
 * Samband-veljaren (kortet nederst og arket): éi liste frå ROUTE_CATALOG i core, med kva som er valt,
 * kva som kan veljast og «Neste hh:mm» per samband. Rein modell, ingen DOM.
 */
import { ROUTE_CATALOG, chosenRoute, clockMinutes, hhmm, legsForMode, nowMinutes, routeHasData, shiftIso, sortDayLegs, todayIso } from "../../../packages/core/index.js";

/** Første avgang frå `now` (minutt) i tabellen til sambandet, i dag, elles første i morgon. Berre rutetabellen. */
export function nextForRoute(route, data, now = nowMinutes(), today = todayIso()) {
  if (!data?.routes) return null;
  const ctx = { routes: data.routes, kombirute: data.kombirute };
  const todayLegs = sortDayLegs(legsForMode(route, today, ctx));
  const next = todayLegs.find((leg) => clockMinutes(leg.departure) >= now);
  if (next) return { when: "today", time: hhmm(next.departure) };
  const first = sortDayLegs(legsForMode(route, shiftIso(today, 1), ctx))[0];
  return first ? { when: "tomorrow", time: hhmm(first.departure) } : { when: "none", time: null };
}

/**
 * @returns {{ selected: string, items: { id: string, line: string, state: "selected"|"available"|"soon",
 *   next: { when: "today"|"tomorrow"|"none", time: string|null }|null }[] }}
 */
export function routePicker(data, ui, now = nowMinutes(), today = todayIso()) {
  const selected = chosenRoute({ routeChoice: ui.routeChoice, routes: data?.routes || null });
  const items = ROUTE_CATALOG.map((entry) => {
    const selectable = routeHasData(entry.id, { routes: data?.routes || null });
    const state = !selectable ? "soon" : entry.id === selected ? "selected" : "available";
    return { id: entry.id, line: entry.line, state, next: selectable ? nextForRoute(entry.id, data, now, today) : null };
  });
  return { selected, items };
}

/**
 * Pilertastane i radiogruppa: neste/førre valbare rad (med runding), Home/End. Returnerer null når tasten ikkje er
 * ein navigasjonstast eller ingen rad kan veljast. `current` er indeksen til raden som har fokus.
 */
export function nextRadioIndex(items, current, key) {
  const usable = items.map((item, index) => (item.state === "soon" ? -1 : index)).filter((index) => index >= 0);
  if (!usable.length) return null;
  const at = usable.indexOf(current);
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return usable[(at + 1) % usable.length];
    case "ArrowUp":
    case "ArrowLeft":
      return usable[(at <= 0 ? usable.length : at) - 1];
    case "Home":
      return usable[0];
    case "End":
      return usable[usable.length - 1];
    default:
      return null;
  }
}
