/** Kvar skalet hentar data, og sjølve hentinga. */
import { productionDataUrl, timetableFingerprint } from "../../../packages/core/index.js";

export const DATA_FILES = {
  routes: "ruter.json",
  kombirute: "kombirute.json",
  messages: "trafikkmeldinger.json",
  signalLog: "signalturar.json",
  connections: "korrespondanse.json",
};

/**
 * Basen for data/*.json. Standard er `./data/` ved sida av skalet (vite dev serverar
 * data/ frå repoet, og byggjet legg ein kopi i dist/data/). Pages-arbeidsflyten set
 * VITE_DATA_BASE til dei levande filene (sjå .github/workflows/pages.yml).
 */
export function dataBase(env = {}) {
  return withSlash(env.VITE_DATA_BASE || "./data/");
}

function withSlash(base) {
  return base.endsWith("/") ? base : `${base}/`;
}

/**
 * Basen for filene Actions oppdaterer berre på main (trafikkmeldingar og signallogg).
 * Som messagesUrl()/signalLogUrl() i vanilla-appen: på /dev/ les vi produksjonsfilene
 * (`<origin><prefiks>/data/`), elles same base som resten. VITE_LIVE_DATA_BASE overstyrer.
 */
export function liveDataBase(env = {}, loc = null) {
  if (env.VITE_LIVE_DATA_BASE) return withSlash(env.VITE_LIVE_DATA_BASE);
  const production = productionDataUrl(loc, "data/");
  return production === "data/" ? dataBase(env) : production;
}

async function getJson(fetchImpl, url, { required = false, cache } = {}) {
  try {
    const response = await fetchImpl(url, cache ? { cache } : undefined);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return await response.json();
  } catch (error) {
    if (required) throw error;
    return null;
  }
}

/**
 * Hentar rutetabell, kombirute, trafikkmeldingar, signallogg og korrespondanse parallelt.
 * Meldingar og signallogg kjem frå `liveBase` (sjå liveDataBase).
 * Berre rutetabellen er påkravd; dei andre kan mangle utan at skalet stoppar.
 */
export async function fetchAppData(fetchImpl, base, liveBase = base) {
  const [routes, kombirute, messages, signalLog, connections] = await Promise.all([
    getJson(fetchImpl, base + DATA_FILES.routes, { required: true }),
    getJson(fetchImpl, base + DATA_FILES.kombirute),
    getJson(fetchImpl, liveBase + DATA_FILES.messages, { cache: "no-cache" }),
    getJson(fetchImpl, liveBase + DATA_FILES.signalLog, { cache: "no-cache" }),
    getJson(fetchImpl, base + DATA_FILES.connections),
  ]);
  return {
    routes,
    kombirute,
    messages,
    signalLog: signalLog && typeof signalLog.days === "object" ? signalLog : null,
    connections: connections && Array.isArray(connections.lines) ? connections : null,
  };
}

const fingerprint = (data) => (data?.routes ? timetableFingerprint(data.routes, data.kombirute, data.connections) : null);
const sameJson = (a, b) => a === b || (a != null && b != null && JSON.stringify(a) === JSON.stringify(b));

/**
 * Nye filer inn i data som alt er vist. Same rutetabell (timetableFingerprint) gjev dei
 * gamle objekta for rutetabell, kombirute og korrespondanse; same meldingar og signallogg
 * gjev dei gamle objekta der òg. Ei valfri fil som manglar no, held på den gamle. Er alt likt, kjem `previous` sjølv tilbake, så React
 * ikkje teiknar på nytt.
 * @returns {{ data: object, timetableChanged: boolean }}
 */
export function mergeLoaded(previous, fresh) {
  // Som loadRoutes() i vanilla: ei valfri fil som ikkje kom, tek ikkje bort den vi har.
  const loaded = {
    ...fresh,
    kombirute: fresh.kombirute ?? previous.kombirute ?? null,
    connections: fresh.connections ?? previous.connections ?? null,
    messages: fresh.messages ?? previous.messages ?? null,
    signalLog: fresh.signalLog ?? previous.signalLog ?? null,
  };
  const timetableChanged = fingerprint(previous) !== fingerprint(loaded);
  const next = {
    ...previous,
    ...(timetableChanged
      ? { routes: loaded.routes, kombirute: loaded.kombirute, connections: loaded.connections }
      : {}),
    messages: sameJson(previous.messages, loaded.messages) ? previous.messages : loaded.messages,
    signalLog: sameJson(previous.signalLog, loaded.signalLog) ? previous.signalLog : loaded.signalLog,
  };
  const unchanged = Object.keys(next).every((key) => next[key] === previous[key]);
  return { data: unchanged ? previous : next, timetableChanged };
}
