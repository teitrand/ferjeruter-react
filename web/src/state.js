/**
 * UI-tilstanden til skalet: éin reducer, så alle endringar går via kjende handlingar.
 * Data (rutetabell osv.) ligg i useAppData, klokka i useClock, minnet i ein ref i App.
 */
import { CHOOSABLE_ROUTES, NO_FILTERS, shiftIso, todayIso } from "../../packages/core/index.js";

/** @returns {import("./model/context.js").UiState} */
export function initialUi({
  routeChoice = "1136",
  lang = "nn",
  override = null,
  date = null,
  hideArrivals = false,
} = {}) {
  return {
    routeChoice,
    lang,
    override,
    date,
    showPast: false,
    filters: NO_FILTERS,
    hideArrivals,
    connection: null,
    messageFilter: "local",
    messagesExpanded: false,
    detail: null,
  };
}

/**
 * @param {import("./model/context.js").UiState} ui
 * @param {{ type: string, [key: string]: any }} action
 */
export function uiReducer(ui, action) {
  switch (action.type) {
    case "route": {
      const routeChoice = CHOOSABLE_ROUTES.has(action.route) ? action.route : "1136";
      // Som selectRoute i vanilla-appen: frå/til gjeld ikkje lenger.
      return routeChoice === ui.routeChoice ? ui : { ...ui, routeChoice, filters: NO_FILTERS };
    }
    case "day": {
      // Lagra som dato, ikkje forskyving, så ei side som står open over midnatt
      // held fram med den dagen du ser på (som i vanilla-appen).
      const date = action.days === 0 ? todayIso() : shiftIso(ui.date || todayIso(), action.days);
      return { ...ui, date, showPast: false };
    }
    case "lang":
      return action.lang === ui.lang ? ui : { ...ui, lang: action.lang };
    case "togglePast":
      return { ...ui, showPast: !ui.showPast };
    case "from":
    case "to": {
      const value = action.value || null;
      return ui.filters[action.type] === value ? ui : { ...ui, filters: { ...ui.filters, [action.type]: value } };
    }
    case "swap": {
      const { from, to } = ui.filters;
      return from || to ? { ...ui, filters: { from: to, to: from } } : ui;
    }
    case "resetFilters": {
      // Berre frå/til og korrespondanse. Ankomsttider, språk, tema, samband og dag blir ikkje rørt.
      const { from, to } = ui.filters;
      return from || to || ui.connection ? { ...ui, filters: NO_FILTERS, connection: null } : ui;
    }
    case "toggleArrivals":
      return { ...ui, hideArrivals: !ui.hideArrivals };
    case "connection":
      return { ...ui, connection: action.id || null };
    case "messageFilter":
      return action.filter === ui.messageFilter ? ui : { ...ui, messageFilter: action.filter };
    case "toggleMessages":
      return { ...ui, messagesExpanded: !ui.messagesExpanded };
    case "detail":
      return { ...ui, detail: action.leg || null };
    case "sanitize": {
      // Val som ikkje gjeld lenger (anna dag, anna samband), blir gløymde som i vanilla-appen.
      const next = { ...ui, ...action.patch };
      return Object.keys(action.patch).every((key) => next[key] === ui[key]) ? ui : next;
    }
    default:
      throw new Error(`ukjend handling ${action.type}`);
  }
}
