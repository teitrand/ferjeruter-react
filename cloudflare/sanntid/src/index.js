/**
 * fergeruter-sanntid: tek imot hendingar og puls frå innsamlaren og svarar appen med siste kjende.
 * Design: docs/innsamlar-worker-endepunkt.md. Eigen worker, så trafikkmeldingar og signaltur-cron
 * ikkje blir rørte. Lagring i D1 (binding DB). Nøkkelen er Worker-løyndomen COLLECTOR_KEY.
 * Workeren spør aldri Entur og lagrar ingen persondata.
 */

export const KEY_HEADER = "X-Fergeruter-Key";
export const MAX_EVENTS = 50;
export const MAX_BODY_BYTES = 64 * 1024;
export const KINDS = new Set(["sailed", "departed", "arrived", "cancelled"]);
/** Minste tid mellom godtekne kall per endepunkt (innsamlaren: hendingar kvart 30. s, puls kvart 2. min). */
export const MIN_INTERVAL_MS = { events: 10_000, heartbeat: 30_000, positions: 10_000 };
export const MAX_POSITIONS = 10;
/** AIS-ferskleik, same tersklar som packages/core/crossing.js (docs/ais.md). Testen held dei like. */
export const AIS_FRESH_MS = 60_000;
export const AIS_STALE_MS = 5 * 60_000;
export const AIS_MOORED_FRESH_MS = 4 * 60_000;
export const AIS_MOORED_STALE_MS = 15 * 60_000;
export const AIS_MOORED_MAX_KN = 0.5;
/** Melding frå framtida (feil klokke) blir ikkje teken imot. */
export const AIS_MAX_FUTURE_MS = 2 * 60_000;
export const COLLECTOR_STALE_MS = 5 * 60_000;
export const LIVE_FALLBACK_MS = 3 * 60_000;
export const EVENTS_KEEP_DAYS = 30;
export const HEARTBEATS_KEEP_DAYS = 2;

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (key TEXT PRIMARY KEY, service_date TEXT NOT NULL, line TEXT NOT NULL,
     kind TEXT NOT NULL, at TEXT NOT NULL, journey_ref TEXT, stop TEXT, slot TEXT, detail TEXT, received_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS events_day ON events (service_date, line)`,
  `CREATE TABLE IF NOT EXISTS heartbeats (id INTEGER PRIMARY KEY AUTOINCREMENT, received_at TEXT NOT NULL, body TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  // Siste AIS-posisjon per fartøy (éi rad per MMSI). Tillegg: gamle tabellar er uendra.
  `CREATE TABLE IF NOT EXISTS ais_latest (mmsi TEXT PRIMARY KEY, line TEXT NOT NULL, name TEXT, latitude REAL NOT NULL,
     longitude REAL NOT NULL, speed_kn REAL, course_deg REAL, heading INTEGER, nav_status INTEGER,
     msgtime TEXT NOT NULL, msgtime_ms INTEGER NOT NULL, received_at TEXT NOT NULL)`,
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Content-Type",
  "Access-Control-Max-Age": "86400",
};

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
const empty = (status, headers = {}) => new Response(null, { status, headers });

export function osloDate(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** Konstant tid: begge sider blir hasha til 32 byte før samanlikning. */
export async function keyMatches(given, expected) {
  if (typeof expected !== "string" || expected.length < 16 || typeof given !== "string") return false;
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isIso = (s) => typeof s === "string" && s.length <= 40 && Number.isFinite(Date.parse(s));
const optStr = (v, max = 200) => v == null || (typeof v === "string" && v.length <= max);

export function eventKey(ev) {
  return [ev.serviceDate, ev.line, ev.kind, ev.journeyRef || "", ev.stop || "", ev.slot || ""].join("|");
}

/** @returns {string|null} feilmelding, eller null om hendinga er gyldig */
export function validateEvent(ev) {
  if (!ev || typeof ev !== "object") return "ikkje objekt";
  if (typeof ev.line !== "string" || !/^[0-9A-Za-z_-]{1,20}$/.test(ev.line)) return "line";
  if (!KINDS.has(ev.kind)) return "kind";
  if (!isDate(ev.serviceDate)) return "serviceDate";
  if (!isIso(ev.at)) return "at";
  if (!optStr(ev.journeyRef) || !optStr(ev.stop, 100) || !optStr(ev.slot, 10)) return "felt";
  if (ev.detail != null && typeof ev.detail !== "object") return "detail";
  return null;
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** @returns {string|null} feilmelding, eller null om AIS-meldinga er gyldig */
export function validatePosition(pos, nowMs) {
  if (!pos || typeof pos !== "object") return "ikkje objekt";
  if (typeof pos.mmsi !== "string" || !/^\d{9}$/.test(pos.mmsi)) return "mmsi";
  if (typeof pos.line !== "string" || !/^[0-9A-Za-z_-]{1,20}$/.test(pos.line)) return "line";
  if (pos.source !== "ais") return "source";
  const lat = num(pos.latitude);
  const lon = num(pos.longitude);
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return "posisjon";
  if (!isIso(pos.msgtime)) return "msgtime";
  if (Date.parse(pos.msgtime) > nowMs + AIS_MAX_FUTURE_MS) return "msgtime-framtid";
  for (const key of ["speedKn", "courseDeg", "heading", "navStatus"]) if (pos[key] != null && num(pos[key]) == null) return key;
  if (!optStr(pos.name, 60)) return "name";
  return null;
}

async function readBody(request) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_BODY_BYTES) return { status: 413 };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { status: 413 };
  try {
    return { body: JSON.parse(text), text };
  } catch {
    return { status: 400 };
  }
}

/** Godtek kallet om det er minst MIN_INTERVAL_MS sidan førre godtekne kall til same endepunkt. */
async function rateLimited(db, name, nowMs) {
  const row = await db.prepare("SELECT v FROM meta WHERE k = ?").bind(`last:${name}`).first();
  const last = row ? Number(row.v) : 0;
  const wait = last + MIN_INTERVAL_MS[name] - nowMs;
  if (wait > 0) return Math.ceil(wait / 1000);
  await db.prepare("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(`last:${name}`, String(nowMs)).run();
  return 0;
}

async function postEvents(request, env, nowMs) {
  const read = await readBody(request);
  if (read.status) return empty(read.status);
  const { body } = read;
  if (!body || body.schema !== 1 || !Array.isArray(body.events) || !body.events.length) return json({ error: "form" }, 400);
  if (body.events.length > MAX_EVENTS) return empty(413);
  for (const ev of body.events) {
    const err = validateEvent(ev);
    if (err) return json({ error: err }, 400);
  }
  const wait = await rateLimited(env.DB, "events", nowMs);
  if (wait) return empty(429, { "Retry-After": String(wait) });
  const receivedAt = new Date(nowMs).toISOString();
  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO events (key, service_date, line, kind, at, journey_ref, stop, slot, detail, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  await env.DB.batch(
    body.events.map((ev) =>
      stmt.bind(eventKey(ev), ev.serviceDate, ev.line, ev.kind, ev.at, ev.journeyRef || null, ev.stop || null, ev.slot || null,
        ev.detail == null ? null : JSON.stringify(ev.detail), receivedAt),
    ),
  );
  return empty(204);
}

async function postPositions(request, env, nowMs) {
  const read = await readBody(request);
  if (read.status) return empty(read.status);
  const { body } = read;
  if (!body || body.schema !== 1 || !Array.isArray(body.positions) || !body.positions.length) return json({ error: "form" }, 400);
  if (body.positions.length > MAX_POSITIONS) return empty(413);
  for (const pos of body.positions) {
    const err = validatePosition(pos, nowMs);
    if (err) return json({ error: err }, 400);
  }
  const wait = await rateLimited(env.DB, "positions", nowMs);
  if (wait) return empty(429, { "Retry-After": String(wait) });
  const receivedAt = new Date(nowMs).toISOString();
  // Berre nyare melding enn den som ligg der (msgtime_ms), så ei forseinka melding ikkje skriv over.
  const stmt = env.DB.prepare(
    `INSERT INTO ais_latest (mmsi, line, name, latitude, longitude, speed_kn, course_deg, heading, nav_status, msgtime, msgtime_ms, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(mmsi) DO UPDATE SET line = excluded.line, name = excluded.name, latitude = excluded.latitude,
       longitude = excluded.longitude, speed_kn = excluded.speed_kn, course_deg = excluded.course_deg, heading = excluded.heading,
       nav_status = excluded.nav_status, msgtime = excluded.msgtime, msgtime_ms = excluded.msgtime_ms, received_at = excluded.received_at
     WHERE excluded.msgtime_ms > ais_latest.msgtime_ms`,
  );
  await env.DB.batch(
    body.positions.map((pos) =>
      stmt.bind(pos.mmsi, pos.line, pos.name ?? null, pos.latitude, pos.longitude, num(pos.speedKn), num(pos.courseDeg),
        num(pos.heading), num(pos.navStatus), new Date(Date.parse(pos.msgtime)).toISOString(), Date.parse(pos.msgtime), receivedAt),
    ),
  );
  return empty(204);
}

async function postHeartbeat(request, env, nowMs) {
  const read = await readBody(request);
  if (read.status) return empty(read.status);
  const { body, text } = read;
  if (!body || body.schema !== 1 || !isIso(body.generatedAt) || (body.lines != null && typeof body.lines !== "object")) {
    return json({ error: "form" }, 400);
  }
  const wait = await rateLimited(env.DB, "heartbeat", nowMs);
  if (wait) return empty(429, { "Retry-After": String(wait) });
  const receivedAt = new Date(nowMs).toISOString();
  const day = 86_400_000;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO heartbeats (received_at, body) VALUES (?, ?)").bind(receivedAt, text),
    env.DB.prepare("DELETE FROM heartbeats WHERE received_at < ?").bind(new Date(nowMs - HEARTBEATS_KEEP_DAYS * day).toISOString()),
    env.DB.prepare("DELETE FROM events WHERE received_at < ?").bind(new Date(nowMs - EVENTS_KEEP_DAYS * day).toISOString()),
  ]);
  return empty(204);
}

/** Stale blir rekna ut når nokon spør (tabellen i docs/innsamlar-worker-endepunkt.md). */
export function lineView(entry, { collectorStale, nowMs }) {
  const lastKnown = entry?.lastKnown || null;
  const observedAt = entry?.observedAt || null;
  if (!lastKnown) return { lastKnown: null, observedAt, stale: true, staleReason: collectorStale ? "collector-down" : "no-data" };
  if (collectorStale) return { lastKnown, observedAt, stale: true, staleReason: "collector-down" };
  const until = Date.parse(lastKnown.validUntil || "");
  const recorded = Date.parse(lastKnown.recordedAt || "");
  const freshUntil = Number.isFinite(until) ? until : Number.isFinite(recorded) ? recorded + LIVE_FALLBACK_MS : 0;
  const fresh = nowMs <= freshUntil;
  return { lastKnown, observedAt, stale: !fresh, staleReason: fresh ? null : "expired" };
}

/**
 * AIS-ferskleik (docs/ais.md): under fart live ≤ 60 s, siste kjende til 5 min, så ukjend.
 * Ved kai (fortøydd eller under 0,5 kn): 4 min og 15 min.
 */
export function aisView(row, nowMs) {
  const speed = row.speed_kn;
  const moored = row.nav_status === 5 || (speed != null && speed < AIS_MOORED_MAX_KN);
  const ageMs = Math.max(0, nowMs - row.msgtime_ms);
  let state = "unknown";
  if (ageMs <= (moored ? AIS_MOORED_FRESH_MS : AIS_FRESH_MS)) state = "live";
  else if (ageMs <= (moored ? AIS_MOORED_STALE_MS : AIS_STALE_MS)) state = "stale";
  return {
    source: "ais",
    mmsi: row.mmsi,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    speedKn: row.speed_kn,
    courseDeg: row.course_deg,
    heading: row.heading,
    navStatus: row.nav_status,
    msgtime: row.msgtime,
    receivedAt: row.received_at,
    moored,
    ageMs,
    state,
    stale: state !== "live",
    staleReason: state === "live" ? null : "expired",
  };
}

export async function buildLatest(db, nowMs) {
  const hb = await db.prepare("SELECT received_at, body FROM heartbeats ORDER BY id DESC LIMIT 1").first();
  let beat = null;
  try {
    beat = hb ? JSON.parse(hb.body) : null;
  } catch {
    beat = null;
  }
  const lastHeartbeatAt = hb?.received_at || null;
  const collectorStale = !lastHeartbeatAt || nowMs - Date.parse(lastHeartbeatAt) > COLLECTOR_STALE_MS;
  const lines = {};
  for (const [line, entry] of Object.entries(beat?.lines || {})) lines[line] = lineView(entry, { collectorStale, nowMs });

  // AIS: nyaste fartøy per linje. Tillegg; manglar tabellen eller er ho tom, er svaret som før.
  try {
    const { results: ais = [] } = await db.prepare("SELECT * FROM ais_latest ORDER BY msgtime_ms").all();
    for (const row of ais) {
      const view = aisView(row, nowMs);
      lines[row.line] ??= lineView(null, { collectorStale, nowMs });
      lines[row.line].ais = view; // sortert stigande: nyaste fartøy sist
    }
  } catch (error) {
    console.error("ais-feil", String(error?.message || error));
  }

  const date = osloDate(nowMs);
  const { results = [] } = await db
    .prepare("SELECT line, kind, at, journey_ref, stop FROM events WHERE service_date = ? ORDER BY at")
    .bind(date)
    .all();
  const today = { date, lines: {} };
  for (const row of results) {
    const day = (today.lines[row.line] ??= { sailed: [], cancelled: [], departures: [] });
    if (row.kind === "sailed" && row.journey_ref && !day.sailed.includes(row.journey_ref)) day.sailed.push(row.journey_ref);
    if (row.kind === "cancelled" && row.journey_ref && !day.cancelled.includes(row.journey_ref)) day.cancelled.push(row.journey_ref);
    if (row.kind === "departed") day.departures.push({ at: row.at, stop: row.stop, journeyRef: row.journey_ref });
  }
  return {
    schema: 1,
    generatedAt: new Date(nowMs).toISOString(),
    collector: { lastHeartbeatAt, stale: collectorStale },
    lines,
    today,
  };
}

export async function handle(request, env, nowMs = Date.now()) {
  const { pathname } = new URL(request.url);
  if (pathname === "/v1/latest") {
    if (request.method === "OPTIONS") return empty(204, CORS);
    if (request.method !== "GET" && request.method !== "HEAD") return empty(405, { Allow: "GET, OPTIONS", ...CORS });
    return json(await buildLatest(env.DB, nowMs), 200, { ...CORS, "Cache-Control": "public, max-age=15" });
  }
  if (pathname === "/v1/events" || pathname === "/v1/heartbeat" || pathname === "/v1/positions") {
    if (request.method !== "POST") return empty(405, { Allow: "POST" });
    if (!(await keyMatches(request.headers.get(KEY_HEADER), env.COLLECTOR_KEY))) return empty(401);
    if (pathname === "/v1/events") return postEvents(request, env, nowMs);
    if (pathname === "/v1/positions") return postPositions(request, env, nowMs);
    return postHeartbeat(request, env, nowMs);
  }
  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      console.error("sanntid-feil", String(error?.message || error));
      return json({ error: "intern feil" }, 500);
    }
  },
};
