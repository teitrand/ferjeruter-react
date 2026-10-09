/**
 * Sist kjende AIS-posisjon i localStorage, så «No»-raden kan vise han med ein gong ved opning (med den
 * verkelege alderen: `at` er msgtime frå AIS, ikkje når vi lagra han) medan det ferske svaret er på veg.
 * Aldri funnen opp: berre det workeren sist gav oss.
 */
export const SANNTID_CACHE_KEY = "fergeruter-sanntid-v1";
export const SANNTID_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const valid = (item, nowMs) =>
  item && typeof item.line === "string" && item.fix && item.fix.source === "ais" &&
  Number.isFinite(item.fix.latitude) && Number.isFinite(item.fix.longitude) && Number.isFinite(item.fix.at) &&
  item.fix.at <= nowMs + 5 * 60000 && nowMs - item.fix.at <= SANNTID_CACHE_MAX_AGE_MS;

export function readSanntidCache(storage = globalThis.localStorage, nowMs = Date.now()) {
  try {
    const parsed = JSON.parse(storage?.getItem(SANNTID_CACHE_KEY) || "null");
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter((item) => valid(item, nowMs));
  } catch {
    return [];
  }
}

export function writeSanntidCache(entries, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SANNTID_CACHE_KEY, JSON.stringify({ v: 1, entries: entries.map(({ line, fix }) => ({ line, fix })) }));
  } catch {
    // localStorage kan vere stengt eller full.
  }
}
