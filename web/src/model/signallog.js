import { DATA_FILES } from "./data.js";

/**
 * Signalloggen blir skriven av to jobbar: heimeserveren (til sanntid-workeren, kvart 10. minutt) og GitHub-jobben
 * (data/signalturar.json på Pages, kvar halvtime, reserve). Appen les begge og tek den nyaste.
 * Jobben skriv kvar halvtime. Appen må henta han på nytt
 * medan sida står open, elles blir han «for gammal» etter 70 min utan at jobben har feila (Entur-/sanntidsdata
 * og meldingar blir alt henta på nytt; loggen vart berre henta ved oppstart).
 */
export const SIGNAL_LOG_POLL_MS = 5 * 60 * 1000;

/**
 * Kjeldene til loggen, i prioritert rekkjefølgje: workeren (`<sanntid>/v1/signalturar`, same base som /v1/latest,
 * og av når sanntid er av) og så fila på Pages. Båe blir henta; den nyaste `updatedAt` vinn, så ein kjelde som
 * manglar, er treg eller står stille ikkje gjer loggen eldre.
 */
export function signalLogUrls(liveBase, sanntidEndpoint = null) {
  const urls = [];
  if (typeof sanntidEndpoint === "string" && /\/v1\/latest$/.test(sanntidEndpoint)) {
    urls.push(sanntidEndpoint.replace(/\/v1\/latest$/, "/v1/signalturar"));
  }
  urls.push(liveBase + DATA_FILES.signalLog);
  return urls;
}

/** Gyldig logg: eit objekt med `days`. */
export function validSignalLog(log) {
  return Boolean(log) && typeof log === "object" && typeof log.days === "object" && log.days !== null;
}

/** Nyaste gyldige logg vinn. Feilande eller eldre svar (t.d. frå ein gammal kant-cache) kan ikkje gjere loggen eldre. */
export function nextSignalLog(previous, incoming) {
  if (!validSignalLog(incoming)) return previous ?? null;
  if (!validSignalLog(previous)) return incoming;
  const a = Date.parse(previous.updatedAt || "");
  const b = Date.parse(incoming.updatedAt || "");
  if (Number.isFinite(a) && Number.isFinite(b) && b < a) return previous;
  // `receivedAt` er workeren sitt eige tillegg og ikkje ein del av loggen.
  const plain = ({ receivedAt: _ignored, ...rest }) => JSON.stringify(rest);
  return plain(previous) === plain(incoming) ? previous : incoming;
}
