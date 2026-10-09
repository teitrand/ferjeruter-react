/**
 * Nattleg samanlikning for ein dag: kva innsamlaren såg (posisjonar og hendingar),
 * kva tripStatus i appen seier med berre signalloggen, og kva signalloggen seier.
 * Resultat: reports/samanlikning-<dato>.json og .md.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { departureStateKey, serviceJourneyId, signalLogStatus, tripStatus } from "../../packages/core/index.js";
import { legsFor } from "./data.js";
import { osloParts } from "./time.js";

const DAY_END = 24 * 60 - 1;

/** ev for tripStatus på ein tidlegare dag (som appen dagen etter). */
function appEvidence(data, legs, date) {
  return {
    date,
    today: "9999-12-31",
    live: null,
    log: data.signalLog,
    cancelledJourneys: new Set(),
    actualDepartures: new Map(),
    confirmedBooked: new Set(),
    dayLegs: legs,
    dateLegs: legs,
    messageCancelled: new Set(),
    sailedJourneys: new Set(),
    clockNow: DAY_END,
  };
}

/** ev med det innsamlaren såg, som om det framleis var den dagen (utan signallogg). */
function collectorEvidence(legs, date, seen) {
  return {
    date,
    today: date,
    live: null,
    log: null,
    cancelledJourneys: seen.cancelled,
    actualDepartures: new Map(),
    confirmedBooked: new Set(),
    dayLegs: legs,
    dateLegs: legs,
    messageCancelled: new Set(),
    sailedJourneys: seen.sailed,
    clockNow: DAY_END,
  };
}

/** Same tre ord som appen viser i lista. */
const word = (key) => ({ gone: "Gått", cancelled: "Avlyst", notRunning: "Ikkje utført", unknown: "Ukjent" })[key] || key || "–";

/**
 * @param {{ data: object, db: ReturnType<import("./db.js").openDb>, date: string, lines: string[],
 *   legsForLine?: (line: string, date: string) => object[] }} opts
 */
export function compareDay({ data, db, date, lines, legsForLine = (line, day) => legsFor(data, line, day) }) {
  const result = { date, generatedAt: new Date().toISOString(), lines: {}, totals: { legs: 0, agree: 0, disagree: 0, noCollectorData: 0 } };
  for (const line of lines) {
    const legs = legsForLine(line, date);
    const events = db.eventsFor(date, line);
    const seen = { sailed: new Set(), cancelled: new Set() };
    for (const ev of events) {
      if (ev.kind === "sailed" && ev.journey_ref) seen.sailed.add(ev.journey_ref);
      if (ev.kind === "cancelled" && ev.journey_ref) seen.cancelled.add(ev.journey_ref);
    }
    const dayStart = Date.parse(`${date}T00:00:00Z`) - 3 * 3600000;
    const positions = db.positionsBetween(dayStart, dayStart + 30 * 3600000, line).filter((p) => osloParts(p.observed_at).date === date);
    const appEv = appEvidence(data, legs, date);
    const colEv = collectorEvidence(legs, date, seen);
    const rows = [];
    for (const leg of legs) {
      const id = serviceJourneyId(leg.id);
      const app = tripStatus(leg, appEv, DAY_END);
      const col = tripStatus(leg, colEv, DAY_END);
      const appKey = departureStateKey(app, { past: true });
      const colKey = positions.length ? departureStateKey(col, { past: true, today: true }) : "unknown";
      const log = leg.signal ? signalLogStatus(leg, date, data.signalLog) : null;
      const collector = seen.cancelled.has(id) ? "cancelled" : seen.sailed.has(id) ? "sailed" : "not-seen";
      // Berre signalturar kan vere usamde: faste turar er «Gått» uansett i appen.
      const comparable = Boolean(leg.signal && positions.length);
      const agree = !comparable || (collector === "sailed") === (appKey === "gone" && app.kind !== "unknown");
      rows.push({
        id,
        departure: leg.departure.slice(0, 5),
        from: leg.from,
        to: leg.to,
        signal: Boolean(leg.signal),
        log,
        app: { kind: app.kind, state: appKey, word: word(appKey) },
        collector,
        collectorState: { kind: col.kind, state: colKey, word: word(colKey) },
        comparable,
        agree,
      });
      result.totals.legs += 1;
      if (!positions.length) result.totals.noCollectorData += 1;
      else if (comparable) result.totals[agree ? "agree" : "disagree"] += 1;
    }
    result.lines[line] = {
      positions: positions.length,
      firstPosition: positions[0] ? new Date(positions[0].observed_at).toISOString() : null,
      lastPosition: positions.length ? new Date(positions[positions.length - 1].observed_at).toISOString() : null,
      sources: positions.reduce((acc, p) => ((acc[p.source] = (acc[p.source] || 0) + 1), acc), {}),
      events: events.reduce((acc, e) => ((acc[e.kind] = (acc[e.kind] || 0) + 1), acc), {}),
      legs: rows,
    };
  }
  return result;
}

export function reportMarkdown(report) {
  const out = [`# Samanlikning ${report.date}`, "", `Laga ${report.generatedAt}.`, ""];
  const t = report.totals;
  out.push(`Turar: ${t.legs}. Signalturar samde: ${t.agree}, usamde: ${t.disagree}. Utan data frå innsamlaren: ${t.noCollectorData}.`, "");
  for (const [line, info] of Object.entries(report.lines)) {
    out.push(`## ${line}`, "", `Posisjonar: ${info.positions} (${JSON.stringify(info.sources)}), hendingar: ${JSON.stringify(info.events)}.`, "");
    out.push("| Avgang | Frå | Til | Signal | Logg | App | Innsamlar | Samde |", "|---|---|---|---|---|---|---|---|");
    for (const r of info.legs) {
      out.push(`| ${r.departure} | ${r.from} | ${r.to} | ${r.signal ? "ja" : ""} | ${r.log || ""} | ${r.app.word} | ${r.collector} | ${r.comparable ? (r.agree ? "ja" : "**nei**") : ""} |`);
    }
    out.push("");
  }
  return out.join("\n");
}

export function writeReport(report, dir) {
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `samanlikning-${report.date}`);
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 1));
  writeFileSync(`${base}.md`, reportMarkdown(report));
  return { json: `${base}.json`, md: `${base}.md` };
}
