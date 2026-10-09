/**
 * Reserve: SIRI VM over REST når straumen er nede. Éin tikk kvart 5. sekund vel
 * linja som har venta lengst, men berre når
 * - linja ikkje er spurd dei siste 60 s,
 * - backoff etter feil/429 er ute,
 * - ratelimiteren (≤2 per 60 s, ≥30 s mellom) seier ja.
 * Kallet går gjennom guardedFetch, den einaste vegen til REST-endepunktet.
 */
import { ENTUR_CLIENT, LIVE_VM_URLS } from "../../packages/core/index.js";
import { createBackoff, retryAfterMs } from "./backoff.js";
import { createRateLimiter, guardedFetch, RateLimitError } from "./ratelimit.js";
import { fromVehicleMonitoring } from "./vehicles.js";

export const PER_LINE_INTERVAL_MS = 60000;

/**
 * @param {{ lines: string[], onVehicle: (live: object) => void, fetchImpl?: typeof fetch,
 *   now?: () => number, log?: Function, limiter?: ReturnType<typeof createRateLimiter>,
 *   inService?: (line: string, nowMs: number) => boolean }} opts
 */
export function createRestPoller({ lines, onVehicle, fetchImpl = fetch, now = Date.now, log = () => {}, limiter, inService = () => true }) {
  const rl = limiter || createRateLimiter({ now });
  const doFetch = guardedFetch(rl, fetchImpl);
  const backoff = createBackoff();
  const lastPoll = Object.fromEntries(lines.map((line) => [line, 0]));
  const state = { requests: 0, errors: 0, lastRequestAt: null, lastStatus: null, lastError: null, empty: 0 };
  let busy = false;

  /** Éin runde. Returnerer linja som vart spurd, eller null. */
  async function tick() {
    if (busy) return null;
    const at = now();
    if (at < backoff.blockedUntil) return null;
    const due = lines
      .filter((line) => LIVE_VM_URLS[line] && at - lastPoll[line] >= PER_LINE_INTERVAL_MS && inService(line, at))
      .sort((a, b) => lastPoll[a] - lastPoll[b]);
    if (!due.length || rl.waitMs() > 0) return null;
    const line = due[0];
    busy = true;
    try {
      lastPoll[line] = at;
      state.lastRequestAt = new Date(at).toISOString();
      const response = await doFetch(LIVE_VM_URLS[line], {
        headers: { "ET-Client-Name": ENTUR_CLIENT, Accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      state.requests += 1;
      state.lastStatus = response.status;
      if (response.status === 429 || response.status >= 500 || !response.ok) {
        const until = backoff.fail(now(), retryAfterMs(response.headers?.get?.("retry-after"), now()));
        rl.blockUntil(until);
        state.errors += 1;
        state.lastError = `HTTP ${response.status}`;
        log("rest-feil", { line, status: response.status, pauseS: Math.round((until - now()) / 1000) });
        return line;
      }
      const live = fromVehicleMonitoring(await response.json(), line, new Date(now()).toISOString());
      backoff.succeed();
      state.lastError = null;
      if (live) onVehicle(live);
      else state.empty += 1;
      return line;
    } catch (error) {
      if (error instanceof RateLimitError) return null;
      const until = backoff.fail(now());
      rl.blockUntil(until);
      state.errors += 1;
      state.lastError = String(error?.message || error);
      log("rest-feil", { line, error: state.lastError, pauseS: Math.round((until - now()) / 1000) });
      return line;
    } finally {
      busy = false;
    }
  }

  return {
    tick,
    state,
    limiter: rl,
    backoff,
    status() {
      return {
        ...state,
        requestsLast60s: rl.recent(),
        blockedUntil: backoff.blockedUntil ? new Date(backoff.blockedUntil).toISOString() : null,
        backoffS: Math.round(backoff.backoffMs / 1000),
      };
    },
  };
}
