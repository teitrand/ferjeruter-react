/**
 * Innsamlaren: straum frå Entur (REST som reserve), lagring, hendingar, status.
 * Loggar éi JSON-linje per hending til stdout (journald).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shouldFetchLive } from "../../packages/core/index.js";
import { aisStatus, createAisStream, createTokenSource, parseMmsiMap } from "./ais.js";
import { loadData, legsFor, writeJsonAtomic } from "./data.js";
import { eventKey, openDb } from "./db.js";
import { createRestPoller } from "./rest.js";
import { createSender } from "./sender.js";
import { buildStatus } from "./status.js";
import { createStream } from "./stream.js";
import { osloDate } from "./time.js";
import { createTracker, evidenceFromEvents } from "./tracker.js";

/** REST tek over når straumen har vore nede så lenge. */
export const STREAM_DOWN_FALLBACK_MS = 2 * 60000;
const HOUR = 3600000;

export function log(msg, extra = {}) {
  process.stdout.write(`${JSON.stringify({ msg, ...extra })}\n`);
}

/** Versjonen deploy-skriptet skreiv i VERSION, elles git (i utviklingskopien). */
function appVersion() {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    return readFileSync(join(here, "..", "..", "VERSION"), "utf8").trim() || null;
  } catch {
    /* ingen VERSION-fil */
  }
  try {
    const cwd = here;
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** Skal REST-reserven gå no? */
export function restActive({ mode, streamConnected, streamDownSince, nowMs }) {
  if (mode === "rest") return true;
  if (streamConnected) return false;
  return streamDownSince != null && nowMs - streamDownSince >= STREAM_DOWN_FALLBACK_MS;
}

/** Bevis for i dag per linje, med tomme lister når vi ikkje har sett noko. */
export function todayEvidence(lines, date, byLine) {
  const empty = () => ({ sailed: [], cancelled: [], departures: [] });
  return { date, lines: Object.fromEntries(lines.map((line) => [line, byLine[line] || empty()])) };
}

export async function run(cfg) {
  mkdirSync(cfg.stateDir, { recursive: true });
  mkdirSync(cfg.reportDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const version = appVersion();
  const db = openDb(cfg.dbPath, { retentionDays: cfg.retentionDays });
  let data = { info: {} };
  const legsForLine = (line, date) => legsFor(data, line, date);
  const tracker = createTracker({ legsFor: legsForLine });
  tracker.restore(db.getMeta("lastKnown"));
  const sender = createSender(cfg.sender, { log, onSent: (keys, atMs) => db.markSent(keys, atMs) });
  if (cfg.sender.requested && !cfg.sender.enabled) log("sendar-av", { reason: "URL eller nøkkel manglar" });
  if (sender.enabled) {
    // Hendingar som ikkje kom fram før førre stopp, blir sende no.
    const unsent = db.unsentEvents();
    for (const { key, event } of unsent) sender.enqueue(event, key);
    if (unsent.length) log("sendar-usende", { n: unsent.length });
  }
  log("start", { version, mode: cfg.mode, lines: cfg.lines, db: cfg.dbPath, sender: sender.enabled, ais: Boolean(cfg.ais?.enabled), node: process.version });
  if (cfg.ais?.requested && !cfg.ais.enabled) log("ais-av", { reason: "klient-ID eller passord manglar" });

  const counters = { positions: 0, duplicates: 0, events: 0, aisPositions: 0, aisDuplicates: 0 };
  const onVehicle = (live) => {
    if (!cfg.lines.includes(String(live.line))) return;
    if (db.insertPosition(live)) counters.positions += 1;
    else {
      counters.duplicates += 1;
      return;
    }
    for (const ev of tracker.observe(live)) {
      if (db.insertEvent(ev)) {
        counters.events += 1;
        log("hending", { kind: ev.kind, line: ev.line, stop: ev.stop || null, journey: ev.journeyRef || null, at: new Date(ev.at).toISOString() });
        sender.enqueue({ ...ev, at: new Date(ev.at).toISOString() }, eventKey(ev));
      }
    }
  };

  const stream = createStream({ lines: cfg.lines, onVehicle, log });

  // AIS: posisjonar med source «ais» i same tabell. Dei går ikkje gjennom tracker (ingen
  // tur-ID eller kai-status frå AIS), så hendingane kjem framleis berre frå Entur.
  const aisTokens = cfg.ais?.enabled ? createTokenSource({ clientId: cfg.ais.clientId, clientSecret: cfg.ais.clientSecret }) : null;
  const aisMmsi = parseMmsiMap(cfg.ais?.mmsi || undefined);
  const ais = aisTokens
    ? createAisStream({
        mmsi: new Map([...aisMmsi].filter(([, line]) => cfg.lines.includes(line))),
        tokens: aisTokens,
        log,
        onPosition: (live) => {
          if (db.insertPosition(live)) {
            counters.aisPositions += 1;
            sender.enqueuePosition(live);
          } else counters.aisDuplicates += 1;
        },
      })
    : null;
  let streamDownSince = Date.now();
  const rest = createRestPoller({
    lines: cfg.lines,
    onVehicle,
    log,
    // Rategrensa held over omstartar (sjå restartBlockUntil i rest.js).
    persist: { load: () => db.getMeta("restRate"), save: (value) => db.setMeta("restRate", value) },
    inService: (line, nowMs) => {
      const legs = legsForLine(line, osloDate(nowMs));
      return legs.length ? shouldFetchLive(legs, nowMs) : true;
    },
  });

  const refreshData = async () => {
    data = await loadData(cfg, { log });
  };
  await refreshData();
  if (cfg.mode === "stream") stream.start();
  ais?.start();

  const statusNow = () => {
    const nowMs = Date.now();
    const today = osloDate(nowMs);
    return buildStatus({
      nowMs,
      startedAt,
      version,
      mode: cfg.mode,
      lines: cfg.lines,
      lastKnown: tracker.lastKnown,
      stream: { ...stream.state, connectsLast60s: stream.connectLimiter.recent() },
      rest: { active: restActive({ mode: cfg.mode, streamConnected: stream.state.connected, streamDownSince, nowMs }), ...rest.status() },
      db: { ...db.stats(), ...counters },
      sender: sender.status(),
      timetable: data.info,
      today: todayEvidence(cfg.lines, today, evidenceFromEvents(db.eventsFor(today))),
      ais: aisStatus(cfg.ais, ais, aisTokens),
    });
  };
  const writeStatus = () => {
    try {
      writeJsonAtomic(cfg.statusPath, statusNow());
      db.setMeta("lastKnown", tracker.lastKnown);
    } catch (error) {
      log("status-feil", { error: String(error?.message || error) });
    }
  };

  const timers = [
    setInterval(async () => {
      const nowMs = Date.now();
      if (stream.state.connected) streamDownSince = null;
      else streamDownSince ??= nowMs;
      if (restActive({ mode: cfg.mode, streamConnected: stream.state.connected, streamDownSince, nowMs })) await rest.tick();
    }, 5000),
    setInterval(writeStatus, cfg.statusEveryMs),
    setInterval(() => sender.flush(), 30000),
    setInterval(() => sender.flushPositions(), 5000),
    setInterval(() => {
      if (!sender.enabled) return;
      const s = statusNow();
      const lines = Object.fromEntries(Object.entries(s.lines).map(([l, v]) => [l, { lastKnown: v.lastKnown, observedAt: v.observedAt }]));
      sender.heartbeat({ generatedAt: s.generatedAt, health: s.health, source: s.source, lines });
    }, 2 * 60000),
    setInterval(refreshData, HOUR),
    setInterval(() => {
      const pruned = db.prune();
      if (pruned.positions || pruned.events) log("sletta-gamle", pruned);
    }, HOUR),
    setInterval(() => {
      const s = statusNow();
      log("puls", {
        health: s.health,
        source: s.source,
        ws: { connected: s.stream.connected, connects: s.stream.connects, messages: s.stream.messages, vehicles: s.stream.vehicles },
        rest: { active: s.rest.active, requests: s.rest.requests, last60s: s.rest.requestsLast60s, errors: s.rest.errors },
        ais: s.ais.enabled ? { connected: s.ais.connected, connects: s.ais.connects, positions: s.ais.positions, error: s.ais.lastError } : false,
        db: { positions: s.db.positions, events: s.db.events },
        lines: Object.fromEntries(Object.entries(s.lines).map(([l, v]) => [l, { stale: v.stale, reason: v.staleReason, ageS: v.ageSeconds }])),
      });
    }, 10 * 60000),
  ];
  log("sletta-gamle", db.prune());
  writeStatus();

  let server = null;
  if (cfg.httpPort > 0) {
    server = createServer((req, res) => {
      if (req.method !== "GET") {
        res.writeHead(405).end();
        return;
      }
      const s = statusNow();
      if (req.url === "/healthz") {
        res.writeHead(s.health === "down" ? 503 : 200, { "Content-Type": "text/plain" }).end(`${s.health}\n`);
      } else if (req.url === "/status" || req.url === "/") {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(s, null, 1));
      } else res.writeHead(404).end();
    });
    server.listen(cfg.httpPort, "127.0.0.1", () => log("http", { listen: `127.0.0.1:${cfg.httpPort}` }));
  }

  const stop = (signal) => {
    log("stopp", { signal });
    for (const t of timers) clearInterval(t);
    stream.stop();
    ais?.stop();
    server?.close();
    writeStatus();
    db.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}
