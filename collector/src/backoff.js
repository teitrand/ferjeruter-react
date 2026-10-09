/**
 * Ventetid etter feil: same dobling som appen (liveBackoff i core: 1 → 2 → 4 → … → 15 min),
 * og aldri kortare enn Retry-After frå Entur.
 */
import { LIVE_MAX_BACKOFF_MS, liveBackoff } from "../../packages/core/index.js";

/** Retry-After i ms (sekund eller HTTP-dato), eller 0. */
export function retryAfterMs(header, nowMs = Date.now()) {
  if (header == null || header === "") return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : 0;
}

export function createBackoff() {
  let backoffMs = 0;
  let blockedUntil = 0;
  let failures = 0;
  return {
    /** Ein feil til. Returnerer tida vi kan prøve att. */
    fail(nowMs, retryAfter = 0) {
      failures += 1;
      const next = liveBackoff(backoffMs, nowMs);
      backoffMs = next.backoffMs;
      blockedUntil = Math.max(next.blockedUntil, nowMs + Math.min(retryAfter, LIVE_MAX_BACKOFF_MS * 4));
      return blockedUntil;
    },
    succeed() {
      backoffMs = 0;
      blockedUntil = 0;
      failures = 0;
    },
    get blockedUntil() {
      return blockedUntil;
    },
    get failures() {
      return failures;
    },
    get backoffMs() {
      return backoffMs;
    },
  };
}
