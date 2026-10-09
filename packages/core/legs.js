/**
 * Grunnleggjande om turar og kaiar som alle dei andre modulane bruker.
 */
import { clockMinutes } from "./time.js?v=84";

export function unwrapSiri(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return unwrapSiri(value[0]);
  if (typeof value === "object") return unwrapSiri(value.value ?? value["#text"]);
  return "";
}

export function serviceJourneyId(value) {
  const text = unwrapSiri(value);
  const match = String(text || "").match(/MOR:ServiceJourney:[^#\s]+/);
  return match ? match[0] : "";
}

export function sameLeg(a, b) {
  if (!a || !b) return false;
  const aId = serviceJourneyId(a.id);
  const bId = serviceJourneyId(b.id);
  if (aId && bId) return aId === bId;
  return a.departure === b.departure && a.from === b.from && a.to === b.to;
}

export function quayPlace(name) {
  if (!name) return "";
  const place = String(name).replace(/\s+(ferjekai|kai)$/i, "").trim();
  return place === "Lekneset" ? "Leknes" : place;
}

export function isUncertainDeparture(departure, notice, switchTime) {
  if (!notice || !switchTime) return false;
  const dep = clockMinutes(departure);
  return dep > clockMinutes(notice) && dep < clockMinutes(switchTime);
}

export function legIndex(legs, leg) {
  return (legs || []).findIndex((item) => sameLeg(item, leg));
}

/** Opphald på kai som er langt nok til å visast som liggetid, t.d. matpause. */
export const LAYOVER_MIN_MINUTES = 20;
