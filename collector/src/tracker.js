/**
 * Held styr på siste kjende posisjon per linje og finn hendingar i straumen:
 * - «departed»: ferja var ved ei kjend kai og er no utanfor radiusen
 * - «arrived»: ferja kom innanfor radiusen til ei kjend kai
 * - «sailed»: liveProvesSailed (core) seier at ein tur i rutetabellen er køyrd
 * - «cancelled»: Entur melder vehicleStatus CANCELLED for turen
 * Hendingane er det same beviset appen sjølv brukar (sett køyrd, faktisk avgang, avlyst).
 */
import { legForLive, liveProvesSailed, nowMinutes, serviceJourneyId } from "../../packages/core/index.js";
import { isFreshAt } from "./status.js";
import { osloDate, osloParts } from "./time.js";

/**
 * @param {{ legsFor?: (line: string, date: string) => object[], now?: () => number }} [opts]
 */
export function createTracker({ legsFor = () => [], now = Date.now } = {}) {
  /** @type {Record<string, object>} */
  const lastKnown = {};
  /** @type {Record<string, object>} siste posisjon per linje+fartøy */
  const previous = {};

  /** Ny posisjon inn. Returnerer hendingane han gav (kan vere tom). */
  function observe(live) {
    const nowMs = now();
    const at = Date.parse(live.recordedAt || live.observedAt) || nowMs;
    const serviceDate = osloDate(at);
    const line = String(live.line);
    const events = [];
    const base = { line, serviceDate, at, journeyRef: live.journeyRef ? serviceJourneyId(live.journeyRef) : null };

    const prevKnown = lastKnown[line];
    if (!prevKnown || Date.parse(prevKnown.recordedAt || 0) <= Date.parse(live.recordedAt || 0)) lastKnown[line] = live;

    const vehicleKey = `${line}|${live.vehicleId || ""}`;
    const prev = previous[vehicleKey];
    previous[vehicleKey] = live;
    const slot = osloParts(at).hhmm;
    if (prev && Date.parse(prev.recordedAt || 0) <= at && at - Date.parse(prev.recordedAt || 0) < 30 * 60000) {
      if (prev.stopName && prev.stopName !== live.stopName) {
        events.push({ ...base, kind: "departed", stop: prev.stopName, slot, detail: { to: live.destination || null } });
      }
      if (live.stopName && prev.stopName !== live.stopName) {
        events.push({ ...base, kind: "arrived", stop: live.stopName, slot, detail: null });
      }
    }
    if (live.vehicleStatus === "CANCELLED" && base.journeyRef) {
      events.push({ ...base, kind: "cancelled", stop: null, detail: null });
    }
    if (isFreshAt(live, nowMs)) {
      const legs = legsFor(line, serviceDate);
      const leg = legForLive(legs, live);
      if (leg && liveProvesSailed(live, leg, nowMinutes(at))) {
        events.push({
          ...base,
          kind: "sailed",
          journeyRef: serviceJourneyId(leg.id) || base.journeyRef,
          stop: leg.from,
          detail: { departure: leg.departure, from: leg.from, to: leg.to, signal: Boolean(leg.signal) },
        });
      }
    }
    return events;
  }

  return {
    observe,
    lastKnown,
    restore(saved) {
      for (const [line, live] of Object.entries(saved || {})) if (live && !lastKnown[line]) lastKnown[line] = live;
    },
  };
}

/** Bevis for i dag per linje (det appen hugsar sjølv: køyrde, avlyste, faktiske avgangar). */
export function evidenceFromEvents(events) {
  const out = {};
  for (const ev of events) {
    const line = (out[ev.line] ||= { sailed: [], cancelled: [], departures: [] });
    if (ev.kind === "sailed" && ev.journey_ref && !line.sailed.includes(ev.journey_ref)) line.sailed.push(ev.journey_ref);
    if (ev.kind === "cancelled" && ev.journey_ref && !line.cancelled.includes(ev.journey_ref)) line.cancelled.push(ev.journey_ref);
    if (ev.kind === "departed") line.departures.push({ stop: ev.stop, at: new Date(ev.at).toISOString(), journeyRef: ev.journey_ref || null });
  }
  return out;
}
