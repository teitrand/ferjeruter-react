import test from "node:test";
import assert from "node:assert/strict";
import { isNoPassengerTrip, naisVesselUrl, nowInfo } from "../../packages/core/index.js";
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
  assert.equal(card.scene.before, true, "dempa ferje på veg inn");
  assert.equal(card.scene.x, 0, "ferja ligg ved startkaia på linja, ikkje utanfor");
  assert.doesNotMatch(card.support.map((s) => s.text).join(" "), /14:40|Planlagd/);
});

test("is-before: ingen padding/forskyving utanfor linja, berre dempa ferje", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../src/styles/nowcard.css", import.meta.url), "utf8");
  const rules = css.split("\n").filter((l) => l.includes("is-before"));
  assert.ok(rules.length > 0);
  assert.doesNotMatch(rules.join("\n"), /padding|translate/);
  assert.match(rules.join("\n"), /opacity/);
});

test("NAIS-lenkja zoomar inn på ferja når AIS-posisjonen er kjend", () => {
  assert.equal(
    naisVesselUrl(257297400, 62.26036, 6.49975),
    "https://nais.kystverket.no/embed/?selectedFeature=datasetId:aisstream;featureId:257297400&zoomAndCenter=12;6.49975:62.26036",
  );
  assert.equal(naisVesselUrl("mmsi:257297400"), "https://nais.kystverket.no/embed/aisstream/257297400");
  assert.equal(naisVesselUrl(257297400, null, 6.5), "https://nais.kystverket.no/embed/aisstream/257297400");
  assert.equal(naisVesselUrl("123"), null);
});

// 04.11.2026 kl. 09:58: ferja på veg Trandal → Valderøya før 11:10 Valderøya→Store Kalvøy. AIS-posisjonen midt
// mellom kaiane (> 4 km frå alle) gav «Utanfor ruta» sjølv om forflyttinga var kjend.
{
  const { statusFromPosition, positionSourceView } = await import("../../packages/core/index.js");
  const { nowCardBase } = await import("../src/model/nowcard.js");
  const nowMs = new Date("2026-11-04T09:58:00+01:00").getTime();
  const quays = ["Standal", "Trandal", "Valderøya", "Store Kalvøy"];
  const legs = [{ from: "Valderøya", to: "Store Kalvøy", departure: "11:10:00", arrival: "11:30:00", signal: true }];
  const fix = (lat, lon, speedKn) => ({ source: "ais", vessel: 257297400, name: "KVERNES", latitude: lat, longitude: lon, speedKn, at: nowMs - 20000 });
  const card = (status, fixes) => {
    const out = statusFromPosition(status, { running: legs, fixes, quays, now: 598, nowMs });
    const info = nowInfo({ status: out, legs, running: legs, ev: { dateLegs: [], messageCancelled: new Set(), cancelledJourneys: new Set() }, nowMs, today: "2026-11-04", legsOn: () => [] });
    const base = nowCardBase({ status: out, info, live: { crossing: null }, data: { positions: fixes }, quays, nowMs });
    return { out, card: composeNowCard(base, positionSourceView(fixes, nowMs, null, quays)) };
  };
  const enRoute = [fix(62.44, 6.22, 11.2)];

  test("forflytting Trandal→Valderøya (planlagd framme): «Ferja går til Valderøya utan passasjerar», ikkje utanfor ruta", () => {
    for (const status of [
      { underway: true, toQuay: "Valderøya", fromQuay: "Trandal", text: "Ferja går til Valderøya utan passasjerar" },
      { planQuay: "Valderøya", fromQuay: "Trandal", text: "Ferja ligg til kai på Valderøya" },
    ]) {
      const { out, card: c } = card(status, enRoute);
      assert.ok(!out.outside);
      assert.equal(out.short, "Ferja går til Valderøya utan passasjerar");
      assert.equal(out.toQuay, "Valderøya");
      assert.equal(c.tag, null);
      assert.doesNotMatch(c.main, /utanfor ruta|ikkje på ruta/i);
      assert.equal(c.main, "Ferja går til Valderøya utan passasjerar");
      assert.equal(c.scene.from, "Trandal", "linja går frå kaia ho forlét");
      assert.equal(c.scene.to, "Valderøya");
      assert.ok(c.scene.x > 0.5 && c.scene.x < 1, `framdrift langs strekninga, fekk ${c.scene.x}`);
      assert.equal(c.scene.before, true, "dempa ferje");
      assert.equal(c.scene.caption, "Utan passasjerar");
    }
  });

  test("langt unna, men neste tur finst: «Ferja er ikkje på ruta no», ikkje «går til Valderøya»", () => {
    // Langt vest for strekninga Trandal–Valderøya (> 10 km), t.d. ved ein verkstad.
    const { out, card: c } = card({ underway: true, toQuay: "Valderøya", fromQuay: "Trandal", text: "Ferja går til Valderøya utan passasjerar" }, [fix(62.36, 6.05, 0.2)]);
    assert.equal(out.outside, true);
    assert.match(c.main, /^Ferja er ikkje på ruta no/);
    assert.equal(c.scene, null);
  });

  test("ligg ved Valderøya før 11:10: «Ligg til kai på Valderøya» med ferja ved kaia på linja", () => {
    const v = { latitude: 62.495872, longitude: 6.128569 };
    const { out, card: c } = card({ planQuay: "Valderøya", fromQuay: "Trandal", text: "Ferja ligg til kai på Valderøya" }, [fix(v.latitude, v.longitude, 0)]);
    assert.equal(out.atQuay, "Valderøya");
    assert.match(c.main, /Ligg til kai på Valderøya/);
    assert.equal(c.scene.from, "Valderøya");
    assert.equal(c.scene.x, 0);
  });

  test("verkeleg utanfor ruta (ingen kjend tur): éi line «Ferja er ikkje på ruta no» + fart, utan merkelapp, pil eller forklaring", () => {
    const { out, card: c } = card({ text: "Ferdig for dagen" }, enRoute);
    assert.equal(out.outside, true);
    assert.equal(c.main, "Ferja er ikkje på ruta no · 11 knop");
    assert.equal(c.tag, null);
    assert.equal(c.scene, null);
    assert.deepEqual(c.support, []);
  });
}
