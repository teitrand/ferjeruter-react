/**
 * AIS frå BarentsWatch Live AIS (opne AIS-data frå Kystverket, NLOD). Sjå docs/ais.md.
 *
 * - Token: client_credentials (scope ais) mot id.barentswatch.no. Tokenet lever 1 time og blir
 *   berre halde i minnet. Kvar tilkopling får eit token som held heile den planlagde levetida.
 *   Token og passord blir aldri logga, lagra eller lagde i status.
 * - Straum: POST /v1/sse/combined (Server-Sent Events) med MMSI-filter. MMSI blir filtrert på
 *   nytt lokalt. Planlagd ny tilkopling kvar 50. min (tel ikkje som feil).
 * - Feil: backoff 15 s → 30 s → … → 15 min, nullstilt berre av ei tilkopling som levde minst
 *   2 min, aldri meir enn 4 tilkoplingar i minuttet, og Retry-After blir respektert.
 *   Token-kall som feilar: minst 60 s til neste.
 * - Vakthund: ingen byte på 10 min gjev ny tilkopling. (9. okt.: Kvernes ved kai sende kvart
 *   ~10 s, Geiranger ved kai éin gong i minuttet, og SSE-kommentarar kjem innimellom.)
 */
import { retryAfterMs } from "./backoff.js";
import { createRateLimiter } from "./ratelimit.js";
import { quayAt } from "./vehicles.js";

export const AIS_TOKEN_URL = "https://id.barentswatch.no/connect/token";
export const AIS_SSE_URL = "https://live.ais.barentswatch.no/v1/sse/combined";
/**
 * MMSI:linje. M/F Kvernes (1136), M/F Geiranger (1135), M/F Dryna (1049).
 * Dryna (258408000) er verifisert mot BarentsWatch (10. okt. 2026: «DRYNA», ved Hundeidvik kai).
 * 1069 Festøya–Solavågen har tre ferjer som går om kvarandre: Festøya 257090560, Solavågen 257090550 og Tidefjord 258220500
 * (alle sett på AIS 10. okt.). Fleire MMSI per linje er greitt: workeren lagrar éin rad per fartøy og gjev alle i `aisAll`,
 * og appen vel ferje per tur etter tid, strekning og kurs (core fixBelongsTo).
 * Bytt fartøy utan kodeendring med FERGERUTER_AIS_MMSI i collector.env.
 */
export const DEFAULT_AIS_MMSI =
  "257297400:1136,257262400:1135,258408000:1049,257090560:1069,257090550:1069,258220500:1069";

export const AIS_RECONNECT_START_MS = 15000;
export const AIS_RECONNECT_MAX_MS = 15 * 60 * 1000;
export const AIS_HEALTHY_AFTER_MS = 2 * 60 * 1000;
export const AIS_PLANNED_RECONNECT_MS = 50 * 60 * 1000;
export const AIS_WATCHDOG_MS = 10 * 60 * 1000;
/** Tokenet må ha minst så lang levetid att når ei tilkopling startar. */
export const AIS_TOKEN_MIN_LEFT_MS = AIS_PLANNED_RECONNECT_MS + 5 * 60 * 1000;
export const AIS_TOKEN_RETRY_MS = 60000;
const PLANNED_GAP_MS = 1000;

/** «257297400:1136,257262400:1135» → Map(257297400 → "1136", …). Ugyldige delar blir hoppa over. */
export function parseMmsiMap(text = DEFAULT_AIS_MMSI) {
  const map = new Map();
  for (const part of String(text).split(",")) {
    const [mmsi, line] = part.split(":").map((s) => s.trim());
    if (/^\d{9}$/.test(mmsi || "") && line) map.set(Number(mmsi), line);
  }
  return map;
}

/**
 * SSE-parsar (text/event-stream). `feed` tek tekstbitar som kan vere delte midt i ei linje.
 * Kallar `onEvent(data, eventName)` for kvar ferdige hending og `onComment()` for «:»-linjer.
 */
export function createSseParser(onEvent, onComment = () => {}) {
  let buf = "";
  let data = [];
  let name = "";
  const line = (raw) => {
    if (raw === "") {
      if (data.length) onEvent(data.join("\n"), name || "message");
      data = [];
      name = "";
      return;
    }
    if (raw.startsWith(":")) return onComment();
    const i = raw.indexOf(":");
    const field = i < 0 ? raw : raw.slice(0, i);
    let value = i < 0 ? "" : raw.slice(i + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "event") name = value;
  };
  return {
    feed(text) {
      buf += text;
      let nl;
      while ((nl = buf.search(/\r\n|\r|\n/)) >= 0) {
        const raw = buf.slice(0, nl);
        buf = buf.slice(nl + (buf[nl] === "\r" && buf[nl + 1] === "\n" ? 2 : 1));
        line(raw);
      }
    },
  };
}

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Éi AIS-melding (combined, Full) → same form som Entur-posisjonane, med source «ais». */
export function fromAisMessage(msg, line, observedAt = new Date().toISOString()) {
  if (!msg || typeof msg !== "object") return null;
  const latitude = num(msg.latitude);
  const longitude = num(msg.longitude);
  if (latitude == null || longitude == null || !msg.msgtime) return null;
  return {
    line: String(line),
    vehicleId: `mmsi:${msg.mmsi}`,
    source: "ais",
    vehicleStatus: null,
    observedAt,
    destination: null,
    direction: "",
    delayMinutes: null,
    latitude,
    longitude,
    monitored: null,
    journeyRef: null,
    atStop: null,
    stopName: quayAt(latitude, longitude),
    stopPointRef: null,
    validUntil: null,
    recordedAt: msg.msgtime,
    speedKn: num(msg.speedOverGround),
    courseDeg: num(msg.courseOverGround),
    heading: num(msg.trueHeading) === 511 ? null : num(msg.trueHeading),
    navStatus: num(msg.navigationalStatus),
    name: typeof msg.name === "string" ? msg.name.trim() || null : null,
  };
}

/**
 * Token-kjelde (client_credentials, scope ais). `get(minLeftMs)` gjev eit token med minst så
 * lang levetid att, og hentar nytt elles. Feil: kastar, og ingen nye kall før det har gått 60 s.
 */
export function createTokenSource({ clientId, clientSecret, fetchImpl = globalThis.fetch, now = Date.now, url = AIS_TOKEN_URL }) {
  let token = null;
  let expiresAt = 0;
  let blockedUntil = 0;
  const state = { requests: 0, failures: 0, validUntil: null, lastError: null };
  return {
    state,
    async get(minLeftMs = AIS_TOKEN_MIN_LEFT_MS) {
      if (token && expiresAt - now() >= minLeftMs) return token;
      if (now() < blockedUntil) throw new Error(`token: ventar ${Math.ceil((blockedUntil - now()) / 1000)} s`);
      state.requests += 1;
      const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: "ais" });
      let res;
      try {
        res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
      } catch (error) {
        state.failures += 1;
        blockedUntil = now() + AIS_TOKEN_RETRY_MS;
        state.lastError = `token: ${String(error?.message || error).slice(0, 120)}`;
        throw new Error(state.lastError);
      }
      if (!res.ok) {
        state.failures += 1;
        blockedUntil = now() + Math.max(AIS_TOKEN_RETRY_MS, retryAfterMs(res.headers?.get?.("retry-after"), now()));
        state.lastError = `token: HTTP ${res.status}`;
        throw new Error(state.lastError);
      }
      const json = await res.json();
      if (!json?.access_token) {
        state.failures += 1;
        blockedUntil = now() + AIS_TOKEN_RETRY_MS;
        state.lastError = "token: manglar i svaret";
        throw new Error(state.lastError);
      }
      token = json.access_token;
      expiresAt = now() + Math.max(60, Number(json.expires_in) || 3600) * 1000;
      state.validUntil = new Date(expiresAt).toISOString();
      state.lastError = null;
      return token;
    },
    invalidate() {
      token = null;
      expiresAt = 0;
      state.validUntil = null;
    },
  };
}

export function nextAisDelay(previousMs) {
  if (!previousMs) return AIS_RECONNECT_START_MS;
  return Math.min(AIS_RECONNECT_MAX_MS, previousMs * 2);
}

/**
 * @param {{ mmsi: Map<number, string>, tokens: ReturnType<typeof createTokenSource>,
 *   onPosition: (live: object) => void, log?: Function, fetchImpl?: typeof fetch, now?: () => number,
 *   setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout, url?: string }} opts
 */
export function createAisStream({
  mmsi,
  tokens,
  onPosition,
  log = () => {},
  fetchImpl = globalThis.fetch,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  url = AIS_SSE_URL,
}) {
  const limiter = createRateLimiter({ maxPerWindow: 4, windowMs: 60000, minIntervalMs: 15000, now });
  const iso = (ms) => new Date(ms).toISOString();
  const state = {
    connected: false,
    connectedAt: null,
    connects: 0,
    reconnectDelayMs: 0,
    nextConnectAt: null,
    lastError: null,
    lastByteAt: null,
    lastEventAt: null,
    events: 0,
    comments: 0,
    positions: 0,
    ignored: 0,
    vessels: Object.fromEntries([...mmsi].map(([m, line]) => [m, { line, name: null, msgtime: null, seenAt: null, latitude: null, longitude: null, speedKn: null }])),
  };
  let stopped = true;
  let gen = 0;
  let abort = null;
  let connectedAtMs = null;
  let timers = new Set();
  let watchdog = null;

  const later = (fn, ms) => {
    const t = setTimer(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
    return t;
  };
  const cancel = (t) => {
    if (!t) return;
    clearTimer(t);
    timers.delete(t);
  };
  const clearAll = () => {
    for (const t of timers) clearTimer(t);
    timers = new Set();
    watchdog = null;
  };
  const bumpWatchdog = (myGen) => {
    cancel(watchdog);
    watchdog = later(() => {
      if (myGen !== gen) return;
      state.lastError = "vakthund: ingen data på 10 min";
      teardown("vakthund");
    }, AIS_WATCHDOG_MS);
  };

  function teardown(reason, { planned = false, retryAfter = 0 } = {}) {
    gen += 1;
    try {
      abort?.abort();
    } catch {
      /* alt avbrote */
    }
    abort = null;
    const lived = connectedAtMs != null ? now() - connectedAtMs : 0;
    connectedAtMs = null;
    state.connected = false;
    clearAll();
    if (stopped) return;
    if (planned) state.reconnectDelayMs = 0;
    else state.reconnectDelayMs = lived >= AIS_HEALTHY_AFTER_MS ? AIS_RECONNECT_START_MS : nextAisDelay(state.reconnectDelayMs);
    const delay = Math.max(planned ? PLANNED_GAP_MS : state.reconnectDelayMs, retryAfter, limiter.waitMs());
    state.nextConnectAt = iso(now() + delay);
    log("ais-ny-tilkopling", { reason, delayS: Math.round(delay / 1000) });
    later(connect, delay);
  }

  function handleEvent(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    state.events += 1;
    state.lastEventAt = iso(now());
    const line = mmsi.get(Number(msg?.mmsi));
    if (!line) {
      state.ignored += 1;
      return;
    }
    const live = fromAisMessage(msg, line, iso(now()));
    if (!live) return;
    const v = state.vessels[msg.mmsi];
    Object.assign(v, { name: live.name || v.name, msgtime: live.recordedAt, seenAt: live.observedAt, latitude: live.latitude, longitude: live.longitude, speedKn: live.speedKn });
    state.positions += 1;
    onPosition(live);
  }

  async function connect() {
    if (stopped) return;
    if (!limiter.tryAcquire()) {
      later(connect, limiter.waitMs() || 1000);
      return;
    }
    const myGen = ++gen;
    state.connects += 1;
    state.nextConnectAt = null;
    let token;
    try {
      token = await tokens.get();
    } catch (error) {
      if (myGen !== gen) return;
      state.lastError = String(error?.message || error);
      log("ais-token-feil", { error: state.lastError });
      teardown("token");
      return;
    }
    if (myGen !== gen || stopped) return;
    abort = new AbortController();
    let res;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream", "Content-Type": "application/json" },
        body: JSON.stringify({ mmsi: [...mmsi.keys()], modelType: "Full", downsample: false }),
        signal: abort.signal,
      });
    } catch (error) {
      if (myGen !== gen) return;
      state.lastError = `sse: ${String(error?.message || error).slice(0, 120)}`;
      teardown("nettverk");
      return;
    }
    token = null;
    if (myGen !== gen) return;
    if (!res.ok) {
      state.lastError = `sse: HTTP ${res.status}`;
      if (res.status === 401) tokens.invalidate();
      const retryAfter = res.status === 429 || res.status >= 500 ? retryAfterMs(res.headers?.get?.("retry-after"), now()) : 0;
      log("ais-http-feil", { status: res.status });
      teardown(`http-${res.status}`, { retryAfter });
      return;
    }
    state.connected = true;
    connectedAtMs = now();
    state.connectedAt = iso(connectedAtMs);
    state.lastError = null;
    log("ais-tilkopla", { mmsi: [...mmsi.keys()] });
    bumpWatchdog(myGen);
    later(() => {
      if (myGen === gen) teardown("planlagt", { planned: true });
    }, AIS_PLANNED_RECONNECT_MS);
    const parser = createSseParser(handleEvent, () => {
      state.comments += 1;
    });
    const decoder = new TextDecoder();
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (myGen !== gen) return;
        if (done) break;
        state.lastByteAt = iso(now());
        bumpWatchdog(myGen);
        parser.feed(decoder.decode(value, { stream: true }));
      }
    } catch (error) {
      if (myGen !== gen) return;
      state.lastError = `sse: ${String(error?.message || error).slice(0, 120)}`;
      teardown("lesefeil");
      return;
    }
    if (myGen !== gen) return;
    state.lastError = state.lastError || "sse: lukka av tenaren";
    log("ais-lukka", {});
    teardown("lukka");
  }

  return {
    state,
    get tokenValidUntil() {
      return tokens.state.validUntil;
    },
    start() {
      if (!stopped) return;
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      teardown("stopp");
    },
    /** For status: tilkoplingar siste minutt. */
    recentConnects: () => limiter.recent(),
  };
}

/** AIS-delen av status-JSON-en: aldri token eller passord. */
export function aisStatus(cfg, stream, tokens) {
  if (!stream) return { enabled: false, requested: Boolean(cfg?.requested), configured: Boolean(cfg?.configured) };
  return {
    enabled: true,
    requested: true,
    configured: true,
    ...stream.state,
    connectsLast60s: stream.recentConnects(),
    tokenValidUntil: tokens?.state.validUntil || null,
    tokenRequests: tokens?.state.requests || 0,
    tokenFailures: tokens?.state.failures || 0,
  };
}
