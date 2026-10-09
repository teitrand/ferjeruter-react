/**
 * Teksten i «No»-raden: kvar ferja er, når neste (eller fyrste) tur går og kor lenge det er til,
 * kor lang overfarta er, og turen etter. Rein logikk utan DOM; alle tal kjem frå rutetabellen
 * (tidene på turane) og frå klokka, ingenting er funne på.
 *
 * Linjene (`kind`):
 *   place      kvar ferja er (same utleiing som statuslinja: AIS > Entur > rutetabell)
 *   cancelled  ein komande avgang i dag er avlyst
 *   next       neste avgang (eller fyrste tur i dag/i morgon/seinare), med nedteljing
 *   trip       «Overfarta tek 10 min, framme 06:50» for turen i `next`
 *   then       turen etter
 * På overfart: `place` (på veg mot …) og `then` (turen som går etter ankomst).
 */
import { t } from "../../assets/i18n.js?v=84";
import { clockMs } from "./crossing.js?v=84";
import { isVisibleDeparture } from "./status.js?v=84";
import { clockMinutes, durationText, formatDay, fromOsloWall, hhmm, shiftIso } from "./time.js?v=84";
import { isCancelledDeparture } from "./tripstatus.js?v=84";

/** Lenger fram enn dette (timar) seier vi ikkje «om N t». */
const COUNTDOWN_MAX_HOURS = 36;
/** Kor mange dagar fram vi leitar etter neste tur når dagen er slutt. */
export const LOOKAHEAD_DAYS = 7;

const visible = (legs) => (legs || []).filter((leg) => leg && leg.departure && isVisibleDeparture(leg));

function departureMs(iso, time) {
  let [hours, minutes] = String(time).split(":").map(Number);
  let day = iso;
  while (hours >= 24) {
    hours -= 24;
    day = shiftIso(day, 1);
  }
  const [year, month, date] = day.split("-").map(Number);
  const stamp = fromOsloWall(year, month, date, hours, minutes || 0);
  return stamp ? Date.parse(stamp) : null;
}

function countdownText(ms, nowMs) {
  if (ms == null || ms - nowMs > COUNTDOWN_MAX_HOURS * 3600000) return "";
  const minutes = Math.floor((ms - nowMs) / 60000);
  if (minutes < 1) return t("duration.now");
  return t("countdown.in", { duration: durationText(minutes) });
}

function sailMinutes(leg) {
  if (!leg?.arrival) return null;
  const minutes = clockMinutes(leg.arrival) - clockMinutes(leg.departure);
  return minutes > 0 ? minutes : null;
}

/** «Overfarta tek 10 min, framme 06:50» */
function tripLine(leg) {
  const minutes = sailMinutes(leg);
  if (minutes == null) return null;
  return { kind: "trip", text: t("now.tripTakes", { duration: durationText(minutes), time: hhmm(leg.arrival) }) };
}

function thenLine(leg) {
  return leg ? { kind: "then", text: t("now.then", { time: hhmm(leg.departure), from: leg.from }) } : null;
}

function nextLine(leg, headKey, params, ms, nowMs) {
  const base = t(headKey, { ...params, time: hhmm(leg.departure), from: leg.from });
  const left = countdownText(ms, nowMs);
  const tag = leg.signal ? t("now.onRequest") : "";
  return { kind: "next", text: [base, left].filter(Boolean).join(", ") + (tag ? ` · ${tag}` : "") };
}

/**
 * @param {object} p
 * @param {object|null} p.status  statuslinja (currentStatus, rett med AIS via statusFromPosition)
 * @param {object[]} p.legs       alle turane i dag, sorterte
 * @param {object[]} p.running    turane som (truleg) køyrer i dag (runningLegs)
 * @param {object} p.ev           bevis (statusEvidence), for avlysingar
 * @param {number} p.nowMs
 * @param {string} p.today        ISO-dato i dag (Oslo)
 * @param {(iso: string) => object[]} p.legsOn  turane ein annan dag (legsForDate)
 * @param {string|null} [p.atQuay]  kaia fersk AIS viser ferja ved (aisQuay); då seier raden «ligg til kai på X»
 * @returns {{ lines: {kind: string, text: string}[] }}
 */
export function nowInfo({ status, legs, running, ev, nowMs, today, legsOn, atQuay = null }) {
  const lines = [];
  let place = status ? status.short || String(status.text || "").replace(/\.$/, "") : "";
  if (atQuay && !status?.underway) place = t("status.mooredAt", { quay: atQuay });
  if (place) lines.push({ kind: "place", text: place });
  // Utanfor ruta (AIS): ingen neste avgang/overfart/framkomst, så det ser ikkje ut som ferja følgjer rutetabellen.
  if (status?.outside) return { lines };
  const ran = visible(running);
  const current = ran.find((leg) => clockMs(leg.departure, nowMs) <= nowMs && nowMs < clockMs(leg.arrival || leg.departure, nowMs)) || null;
  const after = (leg) => ran.find((item) => item !== leg && clockMs(item.departure, nowMs) >= clockMs(leg.arrival || leg.departure, nowMs) - 1000) || null;

  if (current && status?.underway) {
    // På overfart: kor ferja skal, og turen som går etter ankomst. Framdrift og «framme om N min» står i overfartslinja.
    const then = thenLine(after(current));
    // Siste tur i dag: seg kva som kjem etterpå (fyrste tur neste driftsdag), utan nedteljing.
    if (then) lines.push(then);
    else lines.push(...nextDayLines(legsOn, today, nowMs, false));
    return { lines };
  }
  if (current) {
    // Rutetabellen seier overfart, men ferja ligg ved kai (AIS): turen er forseinka, ikkje vist som overfart.
    lines.push({ kind: "next", text: t("now.scheduled", { time: hhmm(current.departure), from: current.from }) });
    const trip = tripLine(current);
    if (trip) lines.push(trip);
    const then = thenLine(after(current));
    if (then) lines.push(then);
    return { lines };
  }

  const upcoming = ran.find((leg) => clockMs(leg.departure, nowMs) > nowMs) || null;
  const cancelled = visible(legs).find(
    (leg) => clockMs(leg.departure, nowMs) > nowMs && !ran.includes(leg) && isCancelledDeparture(leg, ev)
  );
  if (cancelled && (!upcoming || clockMs(cancelled.departure, nowMs) < clockMs(upcoming.departure, nowMs))) {
    lines.push({ kind: "cancelled", text: t("now.cancelled", { time: hhmm(cancelled.departure), from: cancelled.from }) });
  }
  if (upcoming) {
    const earlier = ran.some((leg) => clockMs(leg.departure, nowMs) <= nowMs);
    lines.push(nextLine(upcoming, earlier ? "now.nextToday" : "now.firstToday", {}, clockMs(upcoming.departure, nowMs), nowMs));
    const trip = tripLine(upcoming);
    if (trip) lines.push(trip);
    const then = thenLine(after(upcoming));
    if (then) lines.push(then);
    return { lines };
  }

  // Dagen er slutt: fyrste tur neste driftsdag (i morgon, elles dagen det går tur).
  lines.push(...nextDayLines(legsOn, today, nowMs, true));
  return { lines };
}

/** Fyrste tur ein seinare dag: avgang med nedteljing, overfartstid og turen etter (`full` av: berre avgangen utan nedteljing). */
function nextDayLines(legsOn, today, nowMs, full) {
  for (let ahead = 1; ahead <= LOOKAHEAD_DAYS; ahead += 1) {
    const iso = shiftIso(today, ahead);
    const day = visible(legsOn(iso));
    if (!day.length) continue;
    const first = day[0];
    const ms = departureMs(iso, first.departure);
    const head = ahead === 1 ? "now.firstTomorrow" : "now.firstDay";
    const line = nextLine(first, head, { day: ahead === 1 ? "" : formatDay(iso) }, full ? ms : null, nowMs);
    if (!full) return [{ ...line, kind: "then" }];
    const lines = [line];
    const trip = tripLine(first);
    if (trip) lines.push(trip);
    const then = thenLine(day.find((leg) => leg !== first && clockMinutes(leg.departure) >= clockMinutes(first.arrival || first.departure)));
    if (then) lines.push(then);
    return lines;
  }
  return [];
}
