/**
 * Signalloggen (data/signalturar.json) blir skriven av bakgrunnsjobben kvar halvtime. Appen må henta han på nytt
 * medan sida står open, elles blir han «for gammal» etter 70 min utan at jobben har feila (Entur-/sanntidsdata
 * og meldingar blir alt henta på nytt; loggen vart berre henta ved oppstart).
 */
export const SIGNAL_LOG_POLL_MS = 5 * 60 * 1000;

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
  return JSON.stringify(previous) === JSON.stringify(incoming) ? previous : incoming;
}
