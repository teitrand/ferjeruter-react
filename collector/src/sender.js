/**
 * Sender hendingar til Cloudflare-workeren (design: docs/innsamlar-worker-endepunkt.md).
 * AV som standard: utan FERGERUTER_SENDER_ENABLED=1 og både URL og nøkkel gjer
 * `enqueue` ingenting og ingen nettverkskall går ut. Ikkje slått på før Tor Eirik seier ja.
 */
import { createBackoff } from "./backoff.js";

export const SENDER_KEY_HEADER = "X-Fergeruter-Key";
export const MAX_QUEUE = 500;
export const MAX_BATCH = 50;

/**
 * @param {{ enabled: boolean, requested?: boolean, url: string, key: string }} cfg
 * @param {{ fetchImpl?: typeof fetch, now?: () => number, log?: Function }} [opts]
 */
export function createSender(cfg, { fetchImpl = fetch, now = Date.now, log = () => {} } = {}) {
  const enabled = Boolean(cfg?.enabled && cfg.url && cfg.key);
  const queue = [];
  const backoff = createBackoff();
  const state = { sent: 0, failed: 0, dropped: 0, lastSentAt: null, lastError: null, lastHeartbeatAt: null };
  const base = String(cfg?.url || "").replace(/\/+$/, "");
  const post = (path, body) =>
    fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [SENDER_KEY_HEADER]: cfg.key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

  return {
    enabled,
    enqueue(event) {
      if (!enabled) return false;
      queue.push(event);
      if (queue.length > MAX_QUEUE) {
        queue.shift();
        state.dropped += 1;
      }
      return true;
    },
    /** Sender éin bunt om det er noko i køa og backoff er ute. */
    async flush() {
      if (!enabled || !queue.length || now() < backoff.blockedUntil) return 0;
      const batch = queue.slice(0, MAX_BATCH);
      try {
        const res = await post("/v1/events", { schema: 1, events: batch });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        queue.splice(0, batch.length);
        backoff.succeed();
        state.sent += batch.length;
        state.lastSentAt = new Date(now()).toISOString();
        state.lastError = null;
        return batch.length;
      } catch (error) {
        backoff.fail(now());
        state.failed += 1;
        state.lastError = String(error?.message || error);
        log("sendar-feil", { error: state.lastError });
        return 0;
      }
    },
    /** Puls med siste kjende per linje (sjå docs/innsamlar-worker-endepunkt.md). */
    async heartbeat(summary) {
      if (!enabled || now() < backoff.blockedUntil) return false;
      try {
        const res = await post("/v1/heartbeat", { schema: 1, ...summary });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        state.lastHeartbeatAt = new Date(now()).toISOString();
        return true;
      } catch (error) {
        backoff.fail(now());
        state.failed += 1;
        state.lastError = String(error?.message || error);
        log("sendar-feil", { error: state.lastError });
        return false;
      }
    },
    status() {
      // Aldri URL-en eller nøkkelen i status eller logg.
      return {
        enabled,
        requested: Boolean(cfg?.requested),
        configured: Boolean(cfg?.url && cfg?.key),
        queued: queue.length,
        ...state,
      };
    },
  };
}
