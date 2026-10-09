/**
 * SQLite-lagring med node:sqlite (Node ≥ 22.13, utan flagg i Node 24).
 * WAL, ein skrivar (denne prosessen), lesarar (compare, sqlite3 i skal) går fint samstundes.
 * Rader eldre enn `retentionDays` blir sletta kvar time.
 */
import { DatabaseSync } from "node:sqlite";

const DAY_MS = 86400000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  line TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  recorded_at TEXT,
  source TEXT NOT NULL,
  vehicle_id TEXT,
  journey_ref TEXT,
  latitude REAL,
  longitude REAL,
  at_stop INTEGER,
  stop_name TEXT,
  destination TEXT,
  delay_min INTEGER,
  vehicle_status TEXT,
  valid_until TEXT
);
CREATE INDEX IF NOT EXISTS positions_line_time ON positions(line, observed_at);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  line TEXT NOT NULL,
  kind TEXT NOT NULL,
  service_date TEXT NOT NULL,
  at INTEGER NOT NULL,
  journey_ref TEXT,
  stop TEXT,
  detail TEXT,
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS events_date ON events(service_date, line);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

/** Den unike nøkkelen for ei hending (dag, linje, slag, tur, kai, slot). */
export function eventKey(ev) {
  return [ev.serviceDate, ev.line, ev.kind, ev.journeyRef || "", ev.stop || "", ev.slot || ""].join("|");
}

export function openDb(path, { retentionDays = 30 } = {}) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA auto_vacuum = INCREMENTAL");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);

  const insPos = db.prepare(`INSERT OR IGNORE INTO positions
    (key, line, observed_at, recorded_at, source, vehicle_id, journey_ref, latitude, longitude, at_stop,
     stop_name, destination, delay_min, vehicle_status, valid_until)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insEvent = db.prepare(`INSERT OR IGNORE INTO events
    (key, line, kind, service_date, at, journey_ref, stop, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const setMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const getMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
  const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const bool = (v) => (v === true ? 1 : v === false ? 0 : null);

  return {
    raw: db,
    /** Lagrar éin posisjon. Same fartøy og same recordedAt blir lagra éin gong. Returnerer true om ny. */
    insertPosition(live) {
      const observed = Date.parse(live.observedAt) || Date.now();
      const key = `${live.line}|${live.vehicleId || ""}|${live.recordedAt || observed}`;
      const res = insPos.run(
        key, String(live.line), observed, live.recordedAt || null, live.source, live.vehicleId || null,
        live.journeyRef || null, num(live.latitude), num(live.longitude), bool(live.atStop),
        live.stopName || null, live.destination || null, num(live.delayMinutes), live.vehicleStatus || null,
        live.validUntil || null
      );
      return res.changes > 0;
    },
    /** Returnerer true om hendinga er ny (nøkkelen er unik per dag, linje, slag og tur/kai). */
    insertEvent(ev) {
      const key = eventKey(ev);
      const res = insEvent.run(key, String(ev.line), ev.kind, ev.serviceDate, ev.at, ev.journeyRef || null, ev.stop || null,
        ev.detail ? JSON.stringify(ev.detail) : null);
      return res.changes > 0;
    },
    eventsFor(serviceDate, line = null) {
      const sql = line
        ? "SELECT * FROM events WHERE service_date = ? AND line = ? ORDER BY at"
        : "SELECT * FROM events WHERE service_date = ? ORDER BY at";
      return (line ? db.prepare(sql).all(serviceDate, line) : db.prepare(sql).all(serviceDate)).map((row) => ({
        ...row,
        detail: row.detail ? JSON.parse(row.detail) : null,
      }));
    },
    positionsBetween(fromMs, toMs, line = null) {
      const sql = `SELECT * FROM positions WHERE observed_at >= ? AND observed_at < ?${line ? " AND line = ?" : ""} ORDER BY observed_at`;
      return line ? db.prepare(sql).all(fromMs, toMs, line) : db.prepare(sql).all(fromMs, toMs);
    },
    /** Hendingar som ikkje er sende til workeren, eldste fyrst (til avsendaren ved start). */
    unsentEvents(limit = 500) {
      return db
        .prepare("SELECT * FROM events WHERE sent_at IS NULL ORDER BY at LIMIT ?")
        .all(limit)
        .map((row) => ({
          key: row.key,
          event: {
            line: row.line,
            kind: row.kind,
            serviceDate: row.service_date,
            at: new Date(row.at).toISOString(),
            journeyRef: row.journey_ref,
            stop: row.stop,
            detail: row.detail ? JSON.parse(row.detail) : null,
          },
        }));
    },
    /** Set sent_at på hendingane workeren har teke imot. */
    markSent(keys, atMs = Date.now()) {
      const stmt = db.prepare("UPDATE events SET sent_at = ? WHERE key = ?");
      let n = 0;
      for (const key of keys) n += Number(stmt.run(atMs, key).changes);
      return n;
    },
    setMeta(key, value) {
      setMeta.run(key, JSON.stringify(value));
    },
    getMeta(key) {
      const row = getMeta.get(key);
      return row ? JSON.parse(row.value) : null;
    },
    /** Slettar rader eldre enn retentionDays. Returnerer kor mange. */
    prune(nowMs = Date.now()) {
      const cutoff = nowMs - retentionDays * DAY_MS;
      const cutoffDate = new Date(cutoff).toISOString().slice(0, 10);
      const p = db.prepare("DELETE FROM positions WHERE observed_at < ?").run(cutoff).changes;
      const e = db.prepare("DELETE FROM events WHERE at < ? OR service_date < ?").run(cutoff, cutoffDate).changes;
      if (p + e > 0) db.exec("PRAGMA incremental_vacuum");
      return { positions: Number(p), events: Number(e) };
    },
    stats() {
      const pos = db.prepare("SELECT COUNT(*) AS n, MIN(observed_at) AS oldest, MAX(observed_at) AS newest FROM positions").get();
      const ev = db.prepare("SELECT COUNT(*) AS n FROM events").get();
      const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
      return { positions: Number(pos.n), events: Number(ev.n), oldest: iso(pos.oldest), newest: iso(pos.newest), retentionDays };
    },
    close() {
      db.close();
    },
  };
}
