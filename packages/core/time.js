/**
 * Tid og dato i Europe/Oslo, klokkeslett, høgtidsdagar og datoformat.
 * Rein logikk utan DOM, flytta uendra frå assets/app.js.
 */
import { months, monthsShort, t, weekdays } from "../../assets/i18n.js?v=84";

// Å lage ein Intl.DateTimeFormat er dyrt, og isToday() blir kalla mange gonger per teikning.
let osloFormat = null;

export function osloParts(date = new Date()) {
  if (!osloFormat) {
    osloFormat = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Oslo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  }
  const parts = osloFormat.formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function osloSecondsOfDay() {
  const parts = osloParts();
  return Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
}

export function clockSeconds(time) {
  const [hours, minutes, seconds = 0] = time.split(":").map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

/** Minutt att, alltid runda ned, så vi aldri lovar meir tid enn det er. */
export function minutesLeft(time) {
  return Math.floor((clockSeconds(time) - osloSecondsOfDay()) / 60);
}

export function hasPassed(time) {
  return clockSeconds(time) <= osloSecondsOfDay();
}

export function todayIso() {
  const parts = osloParts();
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftIso(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function nowMinutes(ms = Date.now()) {
  const parts = osloParts(new Date(ms));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

export function clockMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToClock(total) {
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hours = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const minutes = String(wrapped % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function hhmm(time) {
  return time ? time.slice(0, 5) : "";
}

export function weekdayOf(isoDate) {
  return weekdays()[new Date(`${isoDate}T12:00:00Z`).getUTCDay()];
}

export function formatDay(isoDate) {
  const [, month, day] = isoDate.split("-").map(Number);
  return t("date.full", {
    weekday: weekdayOf(isoDate),
    day: String(day),
    month: months()[month - 1],
  });
}

export function headingDay(isoDate) {
  const text = formatDay(isoDate);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatDateOnly(iso) {
  if (!iso) return "";
  const parts = osloParts(new Date(iso));
  return t("date.only", {
    day: String(Number(parts.day)),
    month: months()[Number(parts.month) - 1],
    year: parts.year,
  });
}

export function formatDateTime(iso) {
  if (!iso) return "";
  const parts = osloParts(new Date(iso));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return t("date.time", {
    weekday: weekdayOf(date),
    day: String(Number(parts.day)),
    month: monthsShort()[Number(parts.month) - 1],
    hour: parts.hour,
    minute: parts.minute,
  });
}

export function durationText(minutes) {
  if (minutes < 1) return t("duration.now");
  if (minutes < 60) return t("duration.minutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest
    ? t("duration.hoursMinutes", { n: hours, m: rest })
    : t("duration.hours", { n: hours });
}

export function countdown(time) {
  const minutes = minutesLeft(time);
  if (minutes < 1) return t("duration.now");
  return t("countdown.in", { duration: durationText(minutes) });
}

export function parseClockToken(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/^(\d{1,2})[:.](\d{2})$/) || text.match(/^(\d{2})(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

export const WEEKDAY_TOKEN =
  "(?:mandag|måndag|tysdag|tirsdag|onsdag|torsdag|fredag|laurdag|lørdag|søndag)\\s+";

export const NUMDATE_TOKEN = "(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{2,4}))?";

export function osloIsoFromMs(ms = Date.now()) {
  const parts = osloParts(new Date(ms));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function parseNumDate(day, month, year, refIso) {
  const d = Number(day);
  const m = Number(month);
  if (!d || !m || m > 12 || d > 31) return null;
  const ref = refIso || osloIsoFromMs();
  const refYear = Number(ref.slice(0, 4));
  let y = year ? Number(year) : refYear;
  if (y && y < 100) y += 2000;
  if (!year) {
    const candidate = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const diff =
      (Date.parse(`${ref}T12:00:00Z`) - Date.parse(`${candidate}T12:00:00Z`)) /
      86400000;
    if (diff > 45) y += 1;
  }
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return Number.isNaN(Date.parse(`${iso}T12:00:00Z`)) ? null : iso;
}

export function osloIsoFromInstant(iso) {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  const parts = osloParts(when);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function clockFromInstant(iso) {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  const parts = osloParts(when);
  return `${parts.hour}:${parts.minute}:00`;
}

export function clockFromNow() {
  const parts = osloParts();
  return `${parts.hour}:${parts.minute}:00`;
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function fromOsloWall(year, month, day, hour = 0, minute = 0, second = 0) {
  const wall = `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
  for (const offset of ["+02:00", "+01:00"]) {
    const ms = Date.parse(wall + offset);
    if (!Number.isFinite(ms)) continue;
    const parts = osloParts(new Date(ms));
    if (
      Number(parts.year) === year &&
      Number(parts.month) === month &&
      Number(parts.day) === day &&
      Number(parts.hour) === hour &&
      Number(parts.minute) === minute &&
      Number(parts.second) === second
    ) {
      return new Date(ms).toISOString();
    }
  }
  const ms = Date.parse(`${wall}Z`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function isoFromUnix(ts) {
  const n = Number(ts);
  if (!n) return null;
  return new Date(n * 1000).toISOString();
}

/** Påskesøndag, anonym gregoriansk utrekning (Meeus). */
export function easterSundayIso(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const publicHolidayYears = new Map();

/**
 * Offisielle norske høgtidsdagar som ikkje alltid er søndag.
 * Påskesøndag og pinsedag er alltid søndag og trengst ikkje her.
 */
export function publicHolidays(year) {
  const cached = publicHolidayYears.get(year);
  if (cached) return cached;
  const easter = easterSundayIso(year);
  const set = new Set([
    `${year}-01-01`,
    `${year}-05-01`,
    `${year}-05-17`,
    `${year}-12-25`,
    `${year}-12-26`,
    shiftIso(easter, -3),
    shiftIso(easter, -2),
    shiftIso(easter, 1),
    shiftIso(easter, 39),
    shiftIso(easter, 50),
  ]);
  publicHolidayYears.set(year, set);
  return set;
}

export function isNorwegianPublicHoliday(iso) {
  const year = Number(String(iso || "").slice(0, 4));
  if (!Number.isFinite(year)) return false;
  return publicHolidays(year).has(iso);
}

export function dayType(iso) {
  // FRAM-PDF for kombiruta: «Søndagsruter på andre helge- og høgtidsdagar».
  if (isNorwegianPublicHoliday(iso)) return "sunday";
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  if (dow === 0) return "sunday";
  if (dow === 6) return "saturday";
  return "weekday";
}

export function osloOffsetMinutes(ms) {
  const parts = osloParts(new Date(ms));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((asUtc - ms) / 60000);
}

export function osloDayStartIso(date = todayIso()) {
  const [year, month, day] = date.split("-").map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offset = osloOffsetMinutes(utcMidnight);
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  const sign = offset >= 0 ? "+" : "-";
  return `${date}T00:00:00${sign}${hh}:${mm}`;
}

export function osloHm(iso) {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const parts = osloParts(new Date(ms));
  return `${parts.hour}:${parts.minute}`;
}
