/**
 * Ferjelista for samband med fleire ferjer (1069): éi tekstrad per ferje, utan teikning og linje. Rein modell utan DOM.
 * Kvar rad kjem frå AIS-posisjonen til ferja (fixFromAis, `aisAll` frå workeren): kvar ferja er, fart og kjeldemerke.
 * Ingenting er funne på: utan måling står det «ukjend», og utan nokon måling berre «truleg på veg», berekna frå rutetabellen.
 * Sortert slik at ferja med neste avgang kjem fyrst.
 */
import {
  AT_QUAY_MAX_KN,
  aisSpeed,
  clockMinutes,
  clockMs,
  fixAtQuay,
  fixFreshness,
  headingTowards,
  hhmm,
  isVisibleDeparture,
  osloHm,
  outsideFix,
  runningLegs,
  spokenDuration,
} from "../../../packages/core/index.js";
import { t } from "../components/i18n.js";
import { positionFixes } from "./crossing.js";
import { badgeFor } from "./nowcard.js";

/** Namna på ferjene (AIS har berre store bokstavar utan ø og å). Ukjende ferjer får AIS-namnet med store/små bokstavar. */
export const FERRY_NAMES = { 257090560: "Festøya", 257090550: "Solavågen", 258220500: "Tidefjord" };

export function ferryName(fix) {
  const known = FERRY_NAMES[fix.vessel];
  if (known) return known;
  const raw = String(fix.name || fix.vessel || "");
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : "";
}

const clock = (ms) => osloHm(new Date(ms).toISOString());

/** Minutt (frå midnatt i dag) til neste avgang frå `quay`; avgangar i morgon tel 1440 ekstra. Ingen avgang: Infinity. */
function nextDepartureKey(quay, today, tomorrow, nowMin) {
  const times = (legs, offset) => (legs || []).filter((leg) => leg.from === quay && isVisibleDeparture(leg)).map((leg) => clockMinutes(leg.departure) + offset);
  return Math.min(...times(today, 0).filter((minutes) => minutes >= nowMin), ...times(tomorrow, 1440));
}

function rowFor(fix, { quays, today, tomorrow, nowMs, nowMin }) {
  const state = fixFreshness(fix, nowMs);
  const base = { key: String(fix.vessel), name: ferryName(fix), state, source: "ais", ageMs: Math.max(0, nowMs - fix.at), fixAt: fix.at, speedKn: null, from: null, to: null, quay: null };
  if (state === "unknown") return { ...base, kind: "unknown", sort: Infinity };
  const here = (quays || []).find((quay) => fixAtQuay(fix, quay));
  if (here) return { ...base, kind: "quay", quay: here, sort: nextDepartureKey(here, today, tomorrow, nowMin) };
  if (outsideFix([fix], nowMs)) return { ...base, kind: "outside", sort: Infinity };
  const moving = !fix.moored && fix.speedKn != null && fix.speedKn >= AT_QUAY_MAX_KN;
  if (!moving) return { ...base, kind: "stopped", sort: Infinity };
  const [a, b] = quays && quays.length === 2 ? quays : [null, null];
  const toB = a && b ? headingTowards(fix, a, b) : null;
  const from = toB == null ? null : toB ? a : b;
  const to = toB == null ? null : toB ? b : a;
  return { ...base, kind: "underway", from, to, speedKn: aisSpeed(fix, nowMs), sort: to ? nextDepartureKey(to, today, tomorrow, nowMin) : Infinity - 1 };
}

/**
 * @param {object} p
 * @param {object} p.data      data med positions (AIS per fartøy)
 * @param {string[]} p.quays   kaiane på sambandet (to)
 * @param {object[]} p.today   dagens turar
 * @param {object[]} p.tomorrow morgondagens turar (for sorteringa om natta)
 * @returns {{ rows: object[], calc: object|null }}  `calc`: ingen måling, men ein tur går etter rutetabellen
 */
export function ferryRows({ data, quays, today, tomorrow = [], now, ev, nowMs = Date.now() }) {
  const fixes = positionFixes(data).filter((fix) => fix.source === "ais");
  const ctx = { quays, today, tomorrow, nowMs, nowMin: now };
  const rows = fixes
    .map((fix) => rowFor(fix, ctx))
    .sort((a, b) => a.sort - b.sort || Number(b.kind === "underway") - Number(a.kind === "underway") || a.name.localeCompare(b.name));
  let calc = null;
  if (!rows.length && !data.sanntidPending) {
    const going = runningLegs(today, now, ev)
      .filter((leg) => clockMs(leg.departure, nowMs) <= nowMs && nowMs < clockMs(leg.arrival, nowMs))
      .sort((x, y) => clockMinutes(x.arrival) - clockMinutes(y.arrival))[0];
    if (going) calc = { key: "calc", kind: "calc", state: "calc", from: going.from, to: going.to, arrival: hhmm(going.arrival) };
  }
  return { rows, calc };
}

/** Teksten i ei rad: namn · kvar · fart. */
export function ferryText(row) {
  switch (row.kind) {
    case "quay":
      return t("ferries.atQuay", { quay: row.quay });
    case "underway":
      return row.to ? t("ferries.underwayTo", { from: row.from, to: row.to }) : t("ferries.underway");
    case "outside":
      return t("ferries.outside");
    case "stopped":
      return t("ferries.stopped");
    case "unknown":
      return t("crossing.unknownSince", { time: clock(row.fixAt) });
    default:
      return t("na.underwayCalc", { dest: row.to });
  }
}

/** Sist og kjeldemerket (ikon + tekst, aldri berre farge) for ei rad. */
export function ferryBadge(row) {
  return badgeFor(row.state, { source: "ais", ageMs: row.ageMs });
}

/** Éi kort setning til skjermlesar: «Tidefjord: Festøya mot Solavågen, 9 knop. Målt med AIS for 8 sekund sidan.» Alderen er rundt til minutt. */
export function ferrySentence(row) {
  const place = row.kind === "calc" ? ferryText(row) : `${row.name}: ${ferryText(row)}${row.speedKn != null ? `, ${t("speed.knots", { n: row.speedKn })}` : ""}`;
  const minutes = Math.floor((row.ageMs || 0) / 60000);
  const age = minutes < 1 ? t("countdown.srUnder") : spokenDuration(minutes);
  let source;
  if (row.kind === "calc") source = t("na.srCalc");
  else if (row.state === "live") source = t("ferries.srLive", { age });
  else if (row.state === "stale") source = t("ferries.srLast", { age });
  return `${String(place).replace(/[.\s]+$/, "")}.${source ? ` ${source}` : ""}`;
}
