/**
 * Teksten i «No»-raden og «første tur»-setninga i statuslinja. Rein logikk utan DOM; alle tal kjem frå
 * rutetabellen (tidene på turane) og frå klokka, ingenting er funne på.
 *
 * Éi setning om neste avgang, i statuslinja (model/header.js): «Neste avgang 12:15 frå X, om 1 t 56 min · på signal,
 * ring innan 09:15». Når dagen er slutt er det «Første tur i morgon 07:40 frå X, om 8 t 47 min» (`first`).
 * «No»-raden gjentek ikkje det som står i statuslinja eller i tidslinja; ho har berre:
 *   place      kvar ferja er (same utleiing som statuslinja: AIS > Entur > rutetabell)
 *   cancelled  ein komande avgang i dag er avlyst
 *   scheduled  tabellen seier overfart, men ferja ligg ved kai (forseinka)
 *   trip       «Overfarta tek 10 min, framme 06:50», berre når ankomsttida ikkje alt står på avgangsrada
 */
import { t } from "../../assets/i18n.js?v=84";
import { clockMs } from "./crossing.js?v=84";
import { isVisibleDeparture } from "./status.js?v=84";
import { clockMinutes, durationText, formatDay, fromOsloWall, hhmm, minutesToClock, nowMinutes, shiftIso } from "./time.js?v=84";
import { bookingDeadline } from "./signal.js?v=84";
import { quayPlace } from "./legs.js?v=84";
import { isCancelledDeparture, tripStatus } from "./tripstatus.js?v=84";

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

/**
 * «på signal»-merket til ei avgang: med fristen når han gjeld («ring innan 09:15»), «fristen er ute» etter han,
 * og «bestilt» når Entur viser at turen er tinga. Same reglar som signalnotatet på avgangsrada.
 * @param {{ today?: boolean, booked?: boolean, now?: number }} [opts] `today`: avgangen går i dag (fristen kan vere ute); `now`: minutt sidan midnatt
 */
export function onRequestTag(leg, { today = false, booked = false, now = nowMinutes() } = {}) {
  if (!leg?.signal) return "";
  if (booked) return t("now.onRequestBooked");
  const deadline = bookingDeadline(leg);
  if (!Number.isFinite(deadline)) return t("now.onRequest");
  const time = minutesToClock(deadline);
  if (today && now >= deadline && now < clockMinutes(leg.departure)) return t("now.onRequestLate");
  return t("now.onRequestBy", { time });
}

/**
 * Neste avgang ferja faktisk kan ta. Ein signaltur der fristen er ute og ingen bestilling er sett (`tripStatus` «unknown»)
 * går truleg ikkje, og ferja skal ikkje «flytte seg» til han (t.d. frå Standal til Valderøya for ein tur som ikkje er
 * bestilt). Då er neste avgang neste tur som går etter tabellen, t.d. 16:05 frå Standal. Finst ingen slik tur att i dag,
 * blir den første av dei utgåtte signalturane stå (med «fristen er ute»), så vi ikkje seier «første tur i morgon» om det
 * ikkje er sant. Open eller bestilt signaltur, og vanlege turar, gjeld som før.
 * @param {object[]} upcoming  komande turar i dag (framleis i `running`), sorterte
 * @param {number} now  minutt sidan midnatt (Oslo)
 */
export function pickNextDeparture(upcoming, ev, now) {
  const list = upcoming || [];
  const expired = (leg) => Boolean(leg.signal) && tripStatus(leg, ev, now).kind === "unknown";
  return list.find((leg) => !expired(leg)) || list[0] || null;
}

/** «Første tur i morgon 07:40 frå X, om 8 t 47 min · på signal, ring innan 05:40» */
function firstLine(leg, headKey, params, ms, nowMs) {
  const base = t(headKey, { ...params, time: hhmm(leg.departure), from: leg.from });
  const left = countdownText(ms, nowMs);
  const tag = onRequestTag(leg);
  return [base, left].filter(Boolean).join(", ") + (tag ? ` · ${tag}` : "");
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
 * @param {boolean} [p.arrivalShown]  ankomsttida står på avgangsrada i tidslinja (ankomstar på, ingen frå/til-filter)
 * @returns {{ lines: {kind: string, text: string}[], first: string|null }}
 *   `first`: setninga om første tur når dagen er slutt (til statuslinja), elles null
 */
export function nowInfo({ status, legs, running, ev, nowMs, today, legsOn, arrivalShown = false }) {
  const lines = [];
  let place = status ? status.short || String(status.text || "").replace(/\.$/, "") : "";
  // status.atQuay: fersk AIS ved kai (statusFromPosition). Då seier raden «ligg til kai på X» òg når tabellen seier «ferdig for dagen».
  if (status?.atQuay && !status.underway) place = t("status.mooredAt", { quay: status.atQuay });
  if (place) lines.push({ kind: "place", text: place });
  // Utanfor ruta (AIS): ingen avgang/overfart/framkomst, så det ser ikkje ut som ferja følgjer rutetabellen.
  if (status?.outside) return { lines, first: null };
  const ran = visible(running);
  let current = ran.find((leg) => clockMs(leg.departure, nowMs) <= nowMs && nowMs < clockMs(leg.arrival || leg.departure, nowMs)) || null;
  // AIS seier ferja ligg ved ei anna kai enn turen startar frå (t.d. Standal medan turen går frå Valderøya): ho er på veg
  // til turen, så «Planlagd avgang» frå ei kai ho ikkje ligg ved vil villeie. Då gjeld det neste turen ho kan ta.
  if (current && status?.atQuay && quayPlace(current.from) !== quayPlace(status.atQuay)) current = null;
  // På overfart står framdrift og «framme om N min» i overfartslinja, og neste avgang i statuslinja.
  if (current && status?.underway) return { lines, first: null };
  const trip = (leg) => {
    const line = arrivalShown ? null : tripLine(leg);
    if (line) lines.push(line);
  };
  if (current) {
    // Rutetabellen seier overfart, men ferja ligg ved kai (AIS): turen er forseinka, ikkje vist som overfart.
    lines.push({ kind: "scheduled", text: t("now.scheduled", { time: hhmm(current.departure), from: current.from }) });
    trip(current);
    return { lines, first: null };
  }

  const upcoming = pickNextDeparture(ran.filter((leg) => clockMs(leg.departure, nowMs) > nowMs), ev, nowMinutes(nowMs));
  const cancelled = visible(legs).find(
    (leg) => clockMs(leg.departure, nowMs) > nowMs && !ran.includes(leg) && isCancelledDeparture(leg, ev)
  );
  if (cancelled && (!upcoming || clockMs(cancelled.departure, nowMs) < clockMs(upcoming.departure, nowMs))) {
    lines.push({ kind: "cancelled", text: t("now.cancelled", { time: hhmm(cancelled.departure), from: cancelled.from }) });
  }
  if (upcoming) {
    trip(upcoming);
    return { lines, first: null };
  }

  // Dagen er slutt: fyrste tur neste driftsdag (i morgon, elles dagen det går tur). Han står ikkje i tidslinja, så
  // overfartstida står her.
  for (let ahead = 1; ahead <= LOOKAHEAD_DAYS; ahead += 1) {
    const iso = shiftIso(today, ahead);
    const day = visible(legsOn(iso));
    if (!day.length) continue;
    const first = day[0];
    const head = ahead === 1 ? "now.firstTomorrow" : "now.firstDay";
    const sentence = firstLine(first, head, { day: ahead === 1 ? "" : formatDay(iso) }, departureMs(iso, first.departure), nowMs);
    const line = tripLine(first);
    if (line) lines.push(line);
    return { lines, first: sentence };
  }
  return { lines, first: null };
}
