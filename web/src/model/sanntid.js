/**
 * AIS-posisjonen frå workeren (fergeruter-sanntid, GET /v1/latest), som fixes til core.
 * Rekkefølgja er AIS > Entur > rutetabell (core bestFix); her er berre henting og tilstand.
 *
 * - Feilar workeren eller serveren (nett, 4 s, 5xx, ugyldig svar), held vi siste posisjon vi
 *   fekk. Ho eldast av seg sjølv (Live → Siste kjende → Ukjent, core fixFreshness), og då tek
 *   Entur over, og så rutetabellen. Ingen feilmelding til brukaren berre fordi workeren manglar.
 * - Posisjonen blir aldri funnen opp: `msgtime` frå AIS er tida, ikkje når vi fekk svaret.
 * - Spør minst 15 s mellom kall i driftsvindauget (same som max-age på svaret) og minst 60 s utanfor (natt),
 *   backoff 1 → 15 min etter feil, og ikkje medan fana er gøymd.
 */
import { fixFromAis, legsForDate, liveBackoff, shouldFetchLive, todayIso } from "../../../packages/core/index.js";
import { planContext } from "./context.js";
import { enturMode } from "./entur.js";

export { SANNTID_URL, sanntidUrl } from "./sanntidUrl.js";
export const SANNTID_TIMEOUT_MS = 4000;
export const SANNTID_MIN_INTERVAL_MS = 15000;
/** Utanfor driftsvindauget (natt): AIS sender heile døgnet, så vi spør, men sjeldnare. */
export const SANNTID_IDLE_INTERVAL_MS = 60000;

/** Linjene sambandet gjeld: éi ferje per linje, kombirute gjev begge. */
export function modeLines(mode) {
  if (mode === "kombi") return ["1136", "1135"];
  return mode ? [String(mode)] : [];
}

/**
 * Svaret frå workeren som `{ line, fix }` per fartøy (fix = PositionFix frå core fixFromAis).
 * null når svaret ikkje har forventa form. Ugyldige posisjonar blir hoppa over.
 */
export function parseSanntid(json) {
  if (!json || json.schema !== 1 || typeof json.lines !== "object" || json.lines === null) return null;
  const entries = [];
  for (const [line, entry] of Object.entries(json.lines)) {
    // `aisAll` har alle fartøy på linja (1069 har tre); ein gammal worker har berre `ais` (nyaste).
    const all = Array.isArray(entry?.aisAll) ? entry.aisAll : entry?.ais ? [entry.ais] : [];
    for (const ais of all) {
      if (!ais || ais.source !== "ais") continue;
      const fix = fixFromAis({
        mmsi: ais.mmsi,
        latitude: ais.latitude,
        longitude: ais.longitude,
        sog: ais.speedKn,
        cog: ais.courseDeg,
        navStatus: ais.navStatus,
        timestamp: ais.msgtime,
      });
      if (fix) entries.push({ line: String(line), fix });
    }
  }
  return { entries };
}

/** Eitt kall: `{ entries }` eller `{ error }`. Aldri kast. */
export async function loadSanntid(fetchImpl, url, { timeoutMs = SANNTID_TIMEOUT_MS, early = null } = {}) {
  if (early) {
    // Svaret på den tidlege hentinga i index.html. Feila ho, er det same feil som om vi hadde spurt sjølve.
    try {
      const parsed = parseSanntid(await early);
      if (!parsed) throw new Error("ugyldig svar");
      return { entries: parsed.entries };
    } catch (error) {
      return { error: String(error?.message || error) };
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, credentials: "omit" });
    if (!response.ok) throw new Error(`${response.status}`);
    const parsed = parseSanntid(await response.json());
    if (!parsed) throw new Error("ugyldig svar");
    return { entries: parsed.entries };
  } catch (error) {
    return { error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @typedef {object} SanntidState
 * @property {{ line: string, fix: object }[]} entries   siste posisjon per fartøy
 * @property {boolean} failed                            siste kall feila
 * @property {boolean} loaded                            fyrste svar eller feil er komme
 * @property {number} backoffMs
 * @property {number} blockedUntil
 */
export function emptySanntid() {
  // loaded: har fyrste svar (eller feil) komme? Før det er posisjonen «på veg», ikkje «berekna».
  return { entries: [], failed: false, loaded: false, backoffMs: 0, blockedUntil: 0 };
}

const sameEntries = (a, b) =>
  a.length === b.length && a.every((item, i) => item.line === b[i].line && item.fix.vessel === b[i].fix.vessel && item.fix.at === b[i].fix.at);

/** Nyaste posisjon per fartøy: ei eldre melding (eller eit tomt svar) skriv ikkje over det vi har. */
export function mergeEntries(previous, fresh) {
  const byVessel = new Map(previous.map((item) => [String(item.fix.vessel), item]));
  for (const item of fresh) {
    const key = String(item.fix.vessel);
    const had = byVessel.get(key);
    if (!had || item.fix.at >= had.fix.at) byVessel.set(key, item);
  }
  return [...byVessel.values()].sort((a, b) => String(a.fix.vessel).localeCompare(String(b.fix.vessel)));
}

/** `loaded` med `{ entries }` eller `{ error }`. Same tilstand ut når ingenting er nytt (ingen ny teikning). */
export function sanntidReducer(state, action) {
  switch (action.type) {
    case "loaded": {
      const { result, at } = action;
      if (result.error) {
        const backoff = liveBackoff(state.backoffMs, at);
        return { ...state, failed: true, loaded: true, backoffMs: backoff.backoffMs, blockedUntil: backoff.blockedUntil };
      }
      const entries = mergeEntries(state.entries, result.entries);
      if (sameEntries(entries, state.entries) && !state.failed && !state.backoffMs && state.loaded) return state;
      return { entries: sameEntries(entries, state.entries) ? state.entries : entries, failed: false, loaded: true, backoffMs: 0, blockedUntil: 0 };
    }
    case "reset":
      return emptySanntid();
    default:
      throw new Error(`ukjend handling ${action.type}`);
  }
}

/**
 * Tid for nytt kall: synleg fane, ikkje i backoff, minst 15 s sidan sist. I driftsvindauget følgjer vi
 * det; utanfor (natt, ferdig for dagen) spør vi minst kvart minutt, for AIS sender òg frå ei ferje ved kai.
 */
export function sanntidDue({ fetchedAt = 0, blockedUntil = 0 }, data, ui, nowMs = Date.now(), hidden = false) {
  if (hidden) return false;
  // Utan rutetabell (ikkje komen enno) veit vi ikkje om vi er i driftsvindauget; det fyrste kallet går likevel med ein gong.
  if (!data.routes && !data.kombirute) return !fetchedAt && !(nowMs < (blockedUntil || 0));
  if (nowMs < (blockedUntil || 0)) return false;
  const since = nowMs - fetchedAt;
  if (since < SANNTID_MIN_INTERVAL_MS) return false;
  const legs = legsForDate(todayIso(), planContext(data, { ...ui, date: null }));
  if (shouldFetchLive(legs, nowMs, blockedUntil)) return true;
  return since >= SANNTID_IDLE_INTERVAL_MS;
}

/** Sambandet AIS gjeld for (same som sanntida frå Entur: i dag, ikkje vald dag). */
export function sanntidMode(data, ui) {
  return enturMode(data, ui);
}

/**
 * Data for modellen: AIS-posisjonane for linjene i sambandet, som PositionFix i `positions`
 * (liveStatus i crossing.js tek dei med saman med Entur). `sanntidOn` seier at AIS-kjelda er i bruk,
 * så fotnoten kan seie kva posisjonen kjem frå.
 */
export function withSanntid(data, state, mode, { on = true } = {}) {
  if (!on) return data;
  // Alle fartøy på linja følgjer med (1069 har tre). Kva ferje som tek kva tur, avgjer core (fixBelongsTo: tid, strekning og kurs).
  const lines = new Set(modeLines(mode));
  return {
    ...data,
    positions: state.entries.filter((item) => lines.has(item.line)).map((item) => item.fix),
    sanntidOn: true,
    sanntidFailed: state.failed,
    // Fyrste svar er ikkje komme: «No»-raden viser eit nøytralt «Hentar posisjon», ikkje «Berekna frå rutetabellen».
    sanntidPending: !state.loaded,
  };
}
