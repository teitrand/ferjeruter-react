import test from "node:test";
import assert from "node:assert/strict";
import { isNoPassengerTrip, nowInfo } from "../../packages/core/index.js";
import { composeNowCard } from "../src/model/nowcard.js";

test("«utan passasjerar» berre Standal–Valderøya, ikkje Valderøya–Store Kalvøy", () => {
  assert.equal(isNoPassengerTrip("Standal", "Valderøya"), true);
  assert.equal(isNoPassengerTrip("Valderøya", "Standal"), true);
  assert.equal(isNoPassengerTrip("Valderøya", "Store Kalvøy"), false);
  assert.equal(isNoPassengerTrip("Store Kalvøy", "Valderøya"), false);
  assert.equal(isNoPassengerTrip("Standal", "Trandal"), false);
});

test("forflytting til Valderøya: kortet viser 11:10 Valderøya→Store Kalvøy, ikkje 14:40 Standal", () => {
  const day = new Date("2026-10-21T09:30:00+02:00").getTime();
  const legs = [
    { from: "Valderøya", to: "Store Kalvøy", departure: "11:10:00", arrival: "11:30:00", signal: true },
    { from: "Standal", to: "Trandal", departure: "14:40:00", arrival: "14:55:00" },
  ];
  const status = { underway: true, toQuay: "Valderøya", text: "Ferja går til Valderøya utan passasjerar" };
  const info = nowInfo({ status, legs, running: legs, ev: {}, nowMs: day, today: "2026-10-21", legsOn: () => [] });
  assert.equal(info.leg.departure, "11:10:00");
  const base = { mode: "other", quay: null, place: "Ferja går til Valderøya", leg: { from: "Valderøya", to: "Store Kalvøy", departure: "11:10", arrival: "11:30" }, legKind: "upcoming", toQuay: "Valderøya" };
  const card = composeNowCard(base, { state: "calc" });
  assert.equal(card.scene.from, "Valderøya");
  assert.equal(card.scene.to, "Store Kalvøy");
  assert.ok(card.scene.x < 0, "ferja til venstre for Valderøya");
  assert.doesNotMatch(card.support.map((s) => s.text).join(" "), /14:40|Planlagd/);
});
