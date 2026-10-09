/**
 * graphql-ws-klient (subprotokoll «graphql-transport-ws») mot Entur Vehicle Positions.
 * Éi tilkopling med éin subscription per linje (vehicles() tek berre éin lineRef).
 *
 * - Ny tilkopling etter brot: backoff 15 s → 30 s → … → 15 min, og aldri meir enn
 *   ei tilkopling per 15 s (eigen ratelimiter, same grenser som REST).
 * - Vi sender graphql-ws-ping («{type:"ping"}») kvart 25. s og svarar på ping frå tenaren med pong.
 *   Entur lukkar ei tilkopling utan trafikk etter om lag 60 s (kode 1006, sett på serveren
 *   9. okt.: med ping kvart minutt døydde kvar tilkopling etter ~116 s). Utan pong på 20 s er
 *   sambandet dødt og blir lukka.
 * - Stille straum er normalt (ferja sender ikkje om natta), så stille åleine gjev ikkje ny tilkopling.
 */
import { COLLECTOR_CLIENT } from "./client.js";
import { createRateLimiter } from "./ratelimit.js";
import { VEHICLES_WS_URL, fromVehicleUpdate, subscriptionQuery } from "./vehicles.js";

export const RECONNECT_START_MS = 15000;
export const RECONNECT_MAX_MS = 15 * 60 * 1000;
export const HEALTHY_AFTER_MS = 2 * 60 * 1000;
/** Godt under tomgangsgrensa til Entur (~60 s), så ein tapt ping ikkje er nok til brot. */
export const PING_EVERY_MS = 25000;
export const PONG_TIMEOUT_MS = 20000;
export const ACK_TIMEOUT_MS = 15000;

/** Neste ventetid før ny tilkopling. */
export function nextReconnectDelay(previousMs) {
  if (!previousMs) return RECONNECT_START_MS;
  return Math.min(RECONNECT_MAX_MS, previousMs * 2);
}

/**
 * @param {{ lines: string[], onVehicle: (live: object) => void, log?: (msg: string, extra?: object) => void,
 *   WebSocketImpl?: any, now?: () => number, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout,
 *   url?: string }} opts
 */
export function createStream({
  lines,
  onVehicle,
  log = () => {},
  WebSocketImpl = globalThis.WebSocket,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  url = VEHICLES_WS_URL,
}) {
  const connectLimiter = createRateLimiter({ maxPerWindow: 4, windowMs: 60000, minIntervalMs: 15000, now });
  const state = {
    connected: false,
    connectedAt: null,
    lastMessageAt: null,
    lastVehicleAt: null,
    connects: 0,
    reconnectDelayMs: 0,
    nextConnectAt: null,
    lastError: null,
    messages: 0,
    vehicles: 0,
  };
  let ws = null;
  let stopped = false;
  let timers = new Set();
  let awaitingPong = false;
  /** Når den gjeldande tilkoplinga fekk connection_ack (ms). Null før ack og etter brot. */
  let ackedAt = null;

  const later = (fn, ms) => {
    const t = setTimer(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
    return t;
  };
  const clearAll = () => {
    for (const t of timers) clearTimer(t);
    timers = new Set();
  };
  const send = (msg) => {
    try {
      ws?.send(JSON.stringify(msg));
    } catch (error) {
      log("ws-send-feil", { error: String(error?.message || error) });
    }
  };

  function scheduleReconnect(reason) {
    if (stopped) return;
    // Berre ei tilkopling som fekk ack og levde lenge nok, nullstiller backoff. Tilkoplingar
    // som døyr før ack, aukar ventetida 15 s → 30 s → … → 15 min.
    const lived = ackedAt != null ? now() - ackedAt : 0;
    ackedAt = null;
    state.reconnectDelayMs = lived >= HEALTHY_AFTER_MS ? RECONNECT_START_MS : nextReconnectDelay(state.reconnectDelayMs);
    const delay = Math.max(state.reconnectDelayMs, connectLimiter.waitMs());
    state.nextConnectAt = new Date(now() + delay).toISOString();
    log("ws-ny-tilkopling", { reason, delayS: Math.round(delay / 1000) });
    later(connect, delay);
  }

  function teardown(reason) {
    const old = ws;
    ws = null;
    state.connected = false;
    clearAll();
    if (old) {
      old.onopen = old.onmessage = old.onerror = old.onclose = null;
      try {
        old.close(1000);
      } catch {
        /* lukka alt */
      }
    }
    scheduleReconnect(reason);
  }

  function connect() {
    if (stopped) return;
    if (!connectLimiter.tryAcquire()) {
      later(connect, connectLimiter.waitMs() || 1000);
      return;
    }
    state.connects += 1;
    state.nextConnectAt = null;
    let socket;
    try {
      socket = new WebSocketImpl(url, {
        protocols: ["graphql-transport-ws"],
        headers: { "ET-Client-Name": COLLECTOR_CLIENT },
      });
    } catch (error) {
      state.lastError = String(error?.message || error);
      teardown("konstruktør-feil");
      return;
    }
    ws = socket;
    const ackTimer = later(() => {
      state.lastError = "ingen connection_ack";
      teardown("ack-timeout");
    }, ACK_TIMEOUT_MS);
    socket.onopen = () => send({ type: "connection_init", payload: { "ET-Client-Name": COLLECTOR_CLIENT } });
    socket.onerror = (event) => {
      state.lastError = String(event?.message || event?.error?.message || "websocket-feil");
    };
    socket.onclose = (event) => {
      if (ws !== socket) return;
      state.lastError = state.lastError || `lukka ${event?.code ?? ""} ${event?.reason ?? ""}`.trim();
      log("ws-lukka", { code: event?.code ?? null, reason: event?.reason || "" });
      teardown("lukka");
    };
    socket.onmessage = (event) => {
      if (ws !== socket) return;
      let msg;
      try {
        msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      } catch {
        return;
      }
      state.lastMessageAt = new Date(now()).toISOString();
      state.messages += 1;
      if (msg.type === "connection_ack") {
        clearTimer(ackTimer);
        timers.delete(ackTimer);
        state.connected = true;
        ackedAt = now();
        state.connectedAt = new Date(ackedAt).toISOString();
        state.lastError = null;
        log("ws-tilkopla", { lines });
        for (const line of lines) send({ id: String(line), type: "subscribe", payload: { query: subscriptionQuery(line) } });
        pingLoop();
      } else if (msg.type === "ping") {
        send({ type: "pong" });
      } else if (msg.type === "pong") {
        awaitingPong = false;
      } else if (msg.type === "next") {
        const list = msg.payload?.data?.vehicles;
        if (msg.payload?.errors?.length) log("ws-graphql-feil", { id: msg.id, errors: msg.payload.errors.map((e) => e.message) });
        for (const update of Array.isArray(list) ? list : []) {
          const live = fromVehicleUpdate(update, msg.id, new Date(now()).toISOString());
          if (!live) continue;
          state.vehicles += 1;
          state.lastVehicleAt = live.observedAt;
          onVehicle(live);
        }
      } else if (msg.type === "error") {
        state.lastError = JSON.stringify(msg.payload).slice(0, 300);
        log("ws-subscribe-feil", { id: msg.id, error: state.lastError });
        teardown("subscribe-feil");
      } else if (msg.type === "complete") {
        log("ws-complete", { id: msg.id });
        teardown("complete");
      }
    };
  }

  function pingLoop() {
    later(() => {
      if (!state.connected) return;
      awaitingPong = true;
      send({ type: "ping" });
      later(() => {
        if (awaitingPong && state.connected) {
          state.lastError = "ingen pong";
          teardown("pong-timeout");
        }
      }, PONG_TIMEOUT_MS);
      pingLoop();
    }, PING_EVERY_MS);
  }

  return {
    state,
    start() {
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      clearAll();
      const old = ws;
      ws = null;
      state.connected = false;
      try {
        old?.close(1000);
      } catch {
        /* lukka alt */
      }
    },
    get connectLimiter() {
      return connectLimiter;
    },
  };
}
