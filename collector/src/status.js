/**
 * «Det vi veit»: siste kjende posisjon per linje med tidspunkt og eit eksplisitt
 * stale-flagg, så appen (steg 8) kan vise siste kjende status eller «Ukjent» i staden for å feile.
 *
 * Ferskleik følgjer isLiveFresh i core: gyldig til `validUntil`, elles 3 min etter `recordedAt`.
 * Her med `now` som parameter, så testane kan styre klokka.
 */
import { LIVE_MAX_AGE_MS } from "../../packages/core/index.js";

export const STATUS_SCHEMA = 1;

export function isFreshAt(live, nowMs) {
  if (!live) return false;
  const until = Date.parse(live.validUntil || "");
  if (Number.isFinite(until)) return until > nowMs;
  const recorded = Date.parse(live.recordedAt || "");
  return Number.isFinite(recorded) && nowMs - recorded < LIVE_MAX_AGE_MS;
}

/**
 * Er kjeldene oppe? Straum: tilkopla (ack). REST: brukt dei siste 3 min utan feil.
 * @returns {"stream"|"rest"|null}
 */
export function activeSource(stream, rest, nowMs) {
  if (stream?.connected) return "stream";
  const last = Date.parse(rest?.lastRequestAt || "");
  if (Number.isFinite(last) && nowMs - last < 3 * 60000 && !rest?.lastError) return "rest";
  return null;
}

/**
 * Status for éi linje.
 * staleReason: null (fersk), «no-data» (aldri sett), «source-down» (ingen kjelde oppe),
 * «expired» (kjelda er oppe, men ferja har ikkje meldt seg; t.d. om natta eller ved kai).
 */
export function lineStatus(live, { nowMs, source }) {
  const fresh = isFreshAt(live, nowMs);
  const observed = Date.parse(live?.observedAt || live?.recordedAt || "");
  let staleReason = null;
  if (!live) staleReason = source ? "no-data" : "source-down";
  else if (!fresh) staleReason = source ? "expired" : "source-down";
  return {
    stale: !fresh,
    staleReason,
    observedAt: live?.observedAt || null,
    recordedAt: live?.recordedAt || null,
    validUntil: live?.validUntil || null,
    ageSeconds: Number.isFinite(observed) ? Math.max(0, Math.round((nowMs - observed) / 1000)) : null,
    lastKnown: live || null,
  };
}

/**
 * Heile status-JSON-en (fil og GET /status). `health`: «ok» når ei kjelde er oppe,
 * «degraded» når vi berre har gamle data, «down» når vi ikkje har noko.
 */
export function buildStatus({ nowMs, startedAt, version, mode, lines, lastKnown, stream, rest, db, sender, timetable, today, ais }) {
  const source = activeSource(stream, rest, nowMs);
  const perLine = {};
  for (const line of lines) perLine[line] = lineStatus(lastKnown[line] || null, { nowMs, source });
  const anyData = Object.values(perLine).some((l) => l.lastKnown);
  return {
    schema: STATUS_SCHEMA,
    generatedAt: new Date(nowMs).toISOString(),
    health: source ? "ok" : anyData ? "degraded" : "down",
    source,
    collector: { version: version || null, startedAt, mode, pid: process.pid },
    lines: perLine,
    today: today || null,
    stream: stream || null,
    rest: rest || null,
    db: db || null,
    timetable: timetable || null,
    sender: sender || { enabled: false },
    // AIS (BarentsWatch) er ei eiga kjelde ved sida av Entur. Påverkar ikkje health/source enno.
    ais: ais || { enabled: false },
  };
}
