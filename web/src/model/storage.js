/**
 * localStorage for skalet. Val og minne brukar same nøklar som vanilla-appen, så dei
 * følgjer med mellom dei (same opphav: teitrand.github.io). Rutetabell-cachen og siste
 * rute har eigne «fergeruter-web-»-nøklar: dei er nye i skalet, og ein installert
 * gammal PWA skal aldri lese noko skalet har skrive der.
 */
import * as core from "../../../packages/core/index.js";
import { ALLOWED_MODES, readSailedJourneys, timetableFingerprint, todayIso, writeSailedJourneys } from "../../../packages/core/index.js";

export const TIMETABLE_CACHE_KEY = "fergeruter-web-timetable-v1";
export const LAST_MODE_KEY = "fergeruter-web-last-mode";

function store(storage) {
  try {
    return storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
  } catch {
    return null;
  }
}

export function readRouteChoice(storage) {
  return core.readRouteChoice(store(storage));
}

export function writeRouteChoice(choice, storage) {
  core.writeRouteChoice(choice, store(storage));
}

export function readHideArrivals(storage) {
  return core.readHideArrivals(store(storage));
}

export function writeHideArrivals(hide, storage) {
  core.writeHideArrivals(hide, store(storage));
}

/** Minne for heile økta: bestilte turar i minnet, køyrde turar i localStorage per dag (same nøkkel som vanilla). */
export function browserMemory(storage) {
  let day = null;
  let sailed = new Set();
  const load = (today) => {
    if (day !== today) {
      day = today;
      sailed = readSailedJourneys(today, store(storage));
    }
    return sailed;
  };
  return {
    confirmedBooked: new Set(),
    sailedJourneys: load,
    rememberSailed(today, id) {
      const ids = load(today);
      if (ids.has(id)) return false;
      ids.add(id);
      writeSailedJourneys(today, ids, store(storage));
      return true;
    },
  };
}

/** Trafikkmeldingane i localStorage (same nøkkel som vanilla), så omleggingar overlever omlasting. */
export function messageCache(storage) {
  return {
    read: () => core.readCachedMessages(store(storage)),
    write: (payload) => core.writeCachedMessages(payload, store(storage)),
  };
}

/** Fyrste opning som installert app (same nøkkel som vanilla). */
export function markPwaFirstOpen(mode, storage) {
  return core.markPwaFirstOpen(store(storage), mode);
}

/**
 * Rutetabell, kombirute og korrespondanse frå sist (som readCachedTimetable i vanilla),
 * så skalet teiknar med ein gong og verkar offline. `fingerprint` avgjer om nye filer
 * er nye (timetableFingerprint i core: fetchedAt, kjelde og gyldig frå).
 */
export function timetableCache(storage) {
  return {
    read() {
      try {
        const parsed = JSON.parse(store(storage)?.getItem(TIMETABLE_CACHE_KEY) || "null");
        return parsed?.routes ? parsed : null;
      } catch {
        return null;
      }
    },
    write({ routes, kombirute, connections }) {
      if (!routes) return;
      try {
        store(storage)?.setItem(
          TIMETABLE_CACHE_KEY,
          JSON.stringify({ routes, kombirute: kombirute || null, connections: connections || null })
        );
      } catch {
        // kvote / privat modus
      }
    },
  };
}

/** Same som timetableFingerprint i core, for eit { routes, kombirute, connections }-objekt. */
export function timetableKey(data) {
  return data?.routes ? timetableFingerprint(data.routes, data.kombirute, data.connections) : null;
}

/** Sambandet som galdt i dag sist (1136/1135/kombi), så tittelen er rett før data er lasta. */
export function readLastMode(storage, today = todayIso()) {
  try {
    const parsed = JSON.parse(store(storage)?.getItem(LAST_MODE_KEY) || "null");
    return parsed && parsed.date === today && ALLOWED_MODES.has(parsed.mode) ? parsed.mode : null;
  } catch {
    return null;
  }
}

export function writeLastMode(mode, storage, today = todayIso()) {
  if (!ALLOWED_MODES.has(mode)) return;
  try {
    store(storage)?.setItem(LAST_MODE_KEY, JSON.stringify({ date: today, mode }));
  } catch {
    // kvote / privat modus
  }
}
