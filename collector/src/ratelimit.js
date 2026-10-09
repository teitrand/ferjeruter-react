/**
 * Grenser for REST-kall til Entur (https://api.entur.io/realtime/v1/rest/vm):
 * Entur tillèt 4 kall i minuttet og ber om minst 15 s mellom kalla. Vi ligg under:
 * - høgst `maxPerWindow` (2) kall i eit glidande vindauge på `windowMs` (60 s)
 * - minst `minIntervalMs` (30 s) mellom to kall
 * Det er halvparten av det Entur tillèt: VM svara 429 på to kall med 20 s mellomrom (9. oktober 2026).
 * - `blockUntil()` (429/Retry-After/backoff) stoppar alle kall til tida er ute
 *
 * Grensene kan ikkje skruast opp over Entur sine: konstruktøren kastar då. Og
 * `guardedFetch` er den einaste vegen til REST-endepunktet i innsamlaren, så ein feil
 * i planlegginga gjev eit avslag (RateLimitError), ikkje eit kall for mykje.
 */
export const ENTUR_MAX_PER_MINUTE = 4;
export const ENTUR_MIN_INTERVAL_MS = 15000;

export class RateLimitError extends Error {
  constructor(waitMs) {
    super(`Ratelimit: vent ${Math.ceil(waitMs / 1000)} s`);
    this.name = "RateLimitError";
    this.waitMs = waitMs;
  }
}

/**
 * @param {{ maxPerWindow?: number, windowMs?: number, minIntervalMs?: number, now?: () => number }} [opts]
 */
export function createRateLimiter({ maxPerWindow = 2, windowMs = 60000, minIntervalMs = 30000, now = Date.now } = {}) {
  if (maxPerWindow * (60000 / windowMs) > ENTUR_MAX_PER_MINUTE || maxPerWindow < 1) {
    throw new Error(`For mange kall: ${maxPerWindow} per ${windowMs} ms er over Entur sine ${ENTUR_MAX_PER_MINUTE}/min`);
  }
  if (minIntervalMs < ENTUR_MIN_INTERVAL_MS) {
    throw new Error(`For kort intervall: ${minIntervalMs} ms er under Entur sine ${ENTUR_MIN_INTERVAL_MS} ms`);
  }
  /** @type {number[]} */
  const stamps = [];
  let blockedUntil = 0;

  const prune = (at) => {
    while (stamps.length && stamps[0] <= at - windowMs) stamps.shift();
  };

  /** Ms til neste kall er lov (0 = no). */
  const waitMs = () => {
    const at = now();
    prune(at);
    let wait = Math.max(0, blockedUntil - at);
    const last = stamps[stamps.length - 1];
    if (last != null) wait = Math.max(wait, last + minIntervalMs - at);
    if (stamps.length >= maxPerWindow) wait = Math.max(wait, stamps[0] + windowMs - at);
    return wait;
  };

  return {
    waitMs,
    /** Tek ein plass om det er lov no. Returnerer true/false; aldri eit kall for mykje. */
    tryAcquire() {
      if (waitMs() > 0) return false;
      stamps.push(now());
      return true;
    },
    /** Stopp alle kall til `untilMs` (t.d. Retry-After eller backoff). Forkortar aldri ein blokk. */
    blockUntil(untilMs) {
      blockedUntil = Math.max(blockedUntil, untilMs);
    },
    get blockedUntil() {
      return blockedUntil;
    },
    /** Kall dei siste `windowMs` (for status-JSON). */
    recent() {
      prune(now());
      return stamps.length;
    },
  };
}

/**
 * fetch som berre går når grensa tillèt det. Kastar RateLimitError elles (ingen kø:
 * kallaren prøver att ved neste planlagde runde).
 * @param {ReturnType<typeof createRateLimiter>} limiter
 * @param {typeof fetch} fetchImpl
 */
export function guardedFetch(limiter, fetchImpl) {
  return async (url, init) => {
    if (!limiter.tryAcquire()) throw new RateLimitError(limiter.waitMs());
    return fetchImpl(url, init);
  };
}
