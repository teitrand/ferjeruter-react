/**
 * Sender hendingar til Cloudflare-workeren (design: docs/innsamlar-worker-endepunkt.md).
 * AV som standard: utan FERGERUTER_SENDER_ENABLED=1 og både URL og nøkkel gjer
 * `enqueue` ingenting og ingen nettverkskall går ut. Ikkje slått på før Tor Eirik seier ja.
 */
import { distanceMeters } from "../../packages/core/index.js";
import { createBackoff, retryAfterMs } from "./backoff.js";

export const SENDER_KEY_HEADER = "X-Fergeruter-Key";
export const MAX_QUEUE = 500;
export const MAX_BATCH = 50;
/**
 * AIS-posisjonar til workeren (POST /v1/positions): siste melding per fartøy, aldri ei kø.
 * Under fart (eller flytta ≥ 30 m sidan sist sende) minst 15 s mellom kall; ved kai minst 60 s.
 * Workeren tek imot eitt kall per 10 s, så éin felles klokke på 15 s held oss godt under grensa.
 * Ved kai sender AIS kvart 10.–180. s, og «live ved kai» gjeld i 4 min (docs/ais.md).
 */
export const POSITION_GAP_MOVING_MS = 15000;
export const POSITION_GAP_QUAY_MS = 60000;
export const POSITION_MOVED_M = 30;
export const POSITION_MAX_BATCH = 10;
export const POSITION_MOVING_KN = 0.5;

/**
 * Køa ligg i minnet, men kvar hending har ein nøkkel (events.key i SQLite). Ved start les
 * main.js usende hendingar (sent_at IS NULL) inn att, og `onSent` set sent_at når workeren
 * har teke imot dei.
 * @param {{ enabled: boolean, requested?: boolean, url: string, key: string }} cfg
 * @param {{ fetchImpl?: typeof fetch, now?: () => number, log?: Function,
 *   onSent?: (keys: string[], atMs: number) => void }} [opts]
 */
export function createSender(cfg, { fetchImpl = fetch, now = Date.now, log = () => {}, onSent = () => {} } = {}) {
  const enabled = Boolean(cfg?.enabled && cfg.url && cfg.key);
  const queue = [];
  const backoff = createBackoff();
  const posBackoff = createBackoff();
  const latestPos = new Map(); // mmsi → nyaste usende AIS-melding
  const sentPos = new Map(); // mmsi → { sentAt, ms, latitude, longitude, moving }
  const posState = { sent: 0, failed: 0, lastSentAt: null, lastError: null, lastBatch: 0 };
  let lastPositionPostAt = 0;
  const state = { sent: 0, failed: 0, dropped: 0, lastSentAt: null, lastError: null, lastHeartbeatAt: null };
  const base = String(cfg?.url || "").replace(/\/+$/, "");
  const post = (path, body) =>
    fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [SENDER_KEY_HEADER]: cfg.key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

  /** Skal denne meldinga sendast no? */
  const positionDue = (pos, nowMs) => {
    const prev = sentPos.get(pos.mmsi);
    if (!prev) return true;
    if (pos.ms <= prev.ms) return false;
    const moved = distanceMeters(prev.latitude, prev.longitude, pos.latitude, pos.longitude) >= POSITION_MOVED_M;
    const moving = (pos.speedKn ?? 0) >= POSITION_MOVING_KN || moved;
    // Skifte mellom fart og kai blir meldt raskt, i tillegg til alt som går føre seg under fart.
    const gap = moving || prev.moving ? POSITION_GAP_MOVING_MS : POSITION_GAP_QUAY_MS;
    return nowMs - prev.sentAt >= gap;
  };

  return {
    enabled,
    /** Hugsar siste AIS-posisjon per fartøy (live frå ais.js). Sender ingenting sjølv. */
    enqueuePosition(live) {
      if (!enabled || !live) return false;
      const mmsi = String(live.vehicleId || "").replace(/^mmsi:/, "");
      const ms = Date.parse(live.recordedAt || "");
      if (!/^\d{9}$/.test(mmsi) || !Number.isFinite(ms)) return false;
      if (!Number.isFinite(live.latitude) || !Number.isFinite(live.longitude)) return false;
      const cur = latestPos.get(mmsi);
      if (cur && cur.ms >= ms) return false;
      latestPos.set(mmsi, {
        mmsi, ms,
        line: String(live.line),
        name: live.name ?? null,
        latitude: live.latitude,
        longitude: live.longitude,
        speedKn: live.speedKn ?? null,
        courseDeg: live.courseDeg ?? null,
        heading: live.heading ?? null,
        navStatus: live.navStatus ?? null,
        msgtime: new Date(ms).toISOString(),
      });
      return true;
    },
    /** Sender dei som er på tide, i eitt kall. Kallast kvart 5. sekund. */
    async flushPositions() {
      if (!enabled || !latestPos.size) return 0;
      const t = now();
      if (t < posBackoff.blockedUntil || t - lastPositionPostAt < POSITION_GAP_MOVING_MS) return 0;
      const batch = [...latestPos.values()].filter((pos) => positionDue(pos, t)).slice(0, POSITION_MAX_BATCH);
      if (!batch.length) return 0;
      lastPositionPostAt = t;
      let res = null;
      try {
        const positions = batch.map(({ ms, ...rest }) => ({ ...rest, source: "ais" }));
        res = await post("/v1/positions", { schema: 1, positions });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        for (const pos of batch) {
          const moving = (pos.speedKn ?? 0) >= POSITION_MOVING_KN;
          sentPos.set(pos.mmsi, { sentAt: t, ms: pos.ms, latitude: pos.latitude, longitude: pos.longitude, moving });
          if (latestPos.get(pos.mmsi) === pos) latestPos.delete(pos.mmsi);
        }
        posBackoff.succeed();
        posState.sent += batch.length;
        posState.lastBatch = batch.length;
        posState.lastSentAt = new Date(t).toISOString();
        posState.lastError = null;
        return batch.length;
      } catch (error) {
        // Retry-After frå workeren (429) er golvet for neste forsøk.
        posBackoff.fail(now(), retryAfterMs(res?.headers?.get?.("retry-after"), now()));
        posState.failed += 1;
        posState.lastError = String(error?.message || error);
        log("sendar-feil", { endpoint: "positions", error: posState.lastError });
        return 0;
      }
    },
    enqueue(event, key = null) {
      if (!enabled) return false;
      if (key && queue.some((item) => item.key === key)) return false;
      queue.push({ key, event });
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
        const res = await post("/v1/events", { schema: 1, events: batch.map((item) => item.event) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        queue.splice(0, batch.length);
        const keys = batch.map((item) => item.key).filter(Boolean);
        if (keys.length) {
          try {
            onSent(keys, now());
          } catch (error) {
            log("sendar-meta-feil", { error: String(error?.message || error) });
          }
        }
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
        positions: { ...posState, pending: latestPos.size },
      };
    },
  };
}
