import assert from "node:assert/strict";
import test from "node:test";
import { ferryStatus } from "../assets/app.js";
import { messageTimeLines } from "../packages/core/index.js";
import { appVersion } from "./helpers/version.mjs";

const {
  SUPPORTED,
  STORAGE_KEY,
  detectLang,
  matchSupportedLang,
  setLang,
  stringKeys,
  stringsFor,
  t,
} = await import(`../assets/i18n.js?v=${appVersion()}`);

function leg(from, to, departure, arrival, dates = ["2026-08-26"]) {
  return { from, to, departure, arrival, activeDates: dates };
}

const wednesday = [
  leg("Standal", "Trandal", "07:40:00", "07:55:00"),
  leg("Trandal", "Sæbø", "08:00:00", "08:30:00"),
];

test("seglingstekst har destinasjon i alle språk", () => {
  setLang("nn");
  assert.equal(t("sailing.route", { from: "Standal", to: "Trandal" }), "Standal → Trandal");
  assert.equal(t("sailing.cancelled"), "Innstilt");
  setLang("en");
  assert.equal(t("sailing.departure", { time: "06:45" }), "Departure 06:45");
  setLang("de");
  assert.equal(t("sailing.arrival", { time: "07:00" }), "Ankunft 07:00");
  setLang("nn");
  assert.equal(t("layover.title"), "Liggetid");
  assert.equal(t("layover.atQuay", { quay: "Sæbø" }), "Liggetid Sæbø");
  assert.equal(t("layover.until", { duration: "1 t 2 min", time: "10:30" }), "1 t 2 min, til 10:30");
  setLang("en");
  assert.equal(t("layover.atQuay", { quay: "Sæbø" }), "Layover at Sæbø");
  setLang("de");
  assert.equal(t("layover.title"), "Liegezeit");
  setLang("nn");
  assert.equal(t("messages.expand"), "Vis meir");
  assert.equal(t("messages.collapse"), "Vis mindre");
  assert.equal(t("messages.andNMore", { n: 2 }), "og 2 til");
  assert.equal(t("messages.fetchedLive", { when: "i dag 18:01" }), "Sist henta i dag 18:01 frå Fjord1");
  assert.equal(t("route.label"), "Vel samband");
  assert.equal(t("place.from"), "Frå");
  assert.equal(t("place.to"), "Til");
  assert.equal(t("place.swap"), "Byt frå og til");
  assert.equal(t("place.via", { via: "Sæbø, Trandal", time: "10:00" }), "Via Sæbø, Trandal, framme 10:00");
  assert.equal(
    t("place.waitAt", { quay: "Sæbø", duration: "1 t 5 min" }),
    "Vent på Sæbø 1 t 5 min"
  );
  assert.equal(t("place.waitUntil", { time: "17:30" }), "til 17:30");
  assert.equal(t("empty.noTo", { to: "Trandal" }), "Ingen turar til Trandal denne dagen.");
  assert.equal(t("route.badgeKombi"), "Kombirute");
  assert.equal(
    t("status.layoverAt", { quay: "Sæbø", duration: "32 min", time: "13:45" }),
    "Ferja ligg til kai på Sæbø. Liggetid 32 min, til 13:45."
  );
  assert.equal(
    t("conn.signalCallPhone", { route: "1136", phone: "91 66 93 40" }),
    "Signaltur, ring 1136 (91 66 93 40)"
  );
  assert.equal(t("conn.transferNote", { dest: "Skår", margin: 5 }), "Bytte på Sæbø mot Skår. Rekna med 5 min til å gå over.");
  assert.equal(t("signal.onRequest"), "På signal");
  assert.equal(t("signal.booked"), "Bestilt signaltur");
  assert.match(t("signal.caveat"), /gjere om/);
  assert.match(t("signal.bookedHow"), /ikkje når bestillinga kom inn/);
  assert.equal(t("signal.callAria", { phone: "916 69 340" }), "Ring ferja 916 69 340");
  setLang("en");
  assert.equal(t("signal.callAria", { phone: "916 69 340" }), "Call the ferry 916 69 340");
  setLang("de");
  assert.equal(t("signal.callAria", { phone: "916 69 340" }), "Fähre anrufen 916 69 340");
  setLang("nn");
  assert.equal(t("install.ios.2"), "Rull og vel «Legg til på heimeskjerm».");
  assert.equal(t("install.lead"), "Då får du Fergeorakelet som eiga app utan adressefelt, og rutetabellen verkar òg utan nett.");
  assert.equal(t("meta.title"), "Fergeorakelet 1136 · Standal–Trandal");
  setLang("en");
  assert.equal(t("install.title"), "Add the app to your home screen");
  assert.equal(t("meta.title"), "The Ferry Oracle 1136 · Standal–Trandal");
  assert.equal(t("install.lead"), "You get The Ferry Oracle as its own app without an address bar, and the timetable also works offline.");
  assert.equal(t("install.desktop.1"), "Look for the install icon in the address bar, or open the menu and choose “Install The Ferry Oracle”.");
  assert.equal(t("feedback.mailSubject"), "Feedback on The Ferry Oracle");
  setLang("de");
  assert.equal(t("install.android.2"), "Wählen Sie „App installieren“ oder „Zum Startbildschirm hinzufügen“.");
  assert.equal(t("meta.title"), "Das Fährorakel 1136 · Standal–Trandal");
  assert.equal(t("install.lead"), "Dann öffnet sich das Fährorakel als eigene App ohne Adressleiste, und der Fahrplan funktioniert auch ohne Netz.");
  assert.equal(t("install.desktop.1"), "Suchen Sie das Installationssymbol in der Adressleiste, oder öffnen Sie das Menü und wählen Sie „Das Fährorakel installieren“.");
  assert.equal(t("feedback.mailSubject"), "Feedback zum Fährorakel");
  setLang("nn");
});

test("same i18n keys in nn, en and de", () => {
  const nn = stringKeys();
  assert.ok(nn.length > 50);
  for (const code of SUPPORTED) {
    assert.deepEqual(Object.keys(stringsFor(code)), nn);
  }
});

test("tingefrist utan om", () => {
  setLang("nn");
  const text = t("signal.leftToBook", { duration: "3 t 15 min" });
  assert.equal(text, "3 t 15 min igjen å tinge");
  assert.doesNotMatch(text, /\bom\b/);
  assert.equal(t("countdown.in", { duration: "3 t 15 min" }), "om 3 t 15 min");
  setLang("nn");
});

test("engelsk og tysk tinge-frist", () => {
  setLang("en");
  assert.equal(t("signal.leftToBook", { duration: "3 h 15 min" }), "3 h 15 min left to book");
  setLang("de");
  assert.equal(
    t("signal.leftToBook", { duration: "3 Std. 15 Min." }),
    "noch 3 Std. 15 Min. zum Anmelden"
  );
  setLang("nn");
});

test("statusfølgjer valt språk", () => {
  setLang("en");
  const en = ferryStatus(wednesday, 7 * 60 + 10, wednesday);
  assert.equal(en.short, "The ferry is at Standal");
  setLang("de");
  const de = ferryStatus(wednesday, 7 * 60 + 10, wednesday);
  assert.equal(de.short, "Die Fähre liegt am Anleger Standal");
  setLang("nn");
  const nn = ferryStatus(wednesday, 7 * 60 + 10, wednesday);
  assert.equal(nn.short, "Ferja ligg til kai på Standal");
});

test("matchSupportedLang les locale-taggar", () => {
  assert.equal(matchSupportedLang("nb-NO"), "nn");
  assert.equal(matchSupportedLang("no-NO"), "nn");
  assert.equal(matchSupportedLang("nn-NO"), "nn");
  assert.equal(matchSupportedLang("de-AT"), "de");
  assert.equal(matchSupportedLang("en-GB"), "en");
  assert.equal(matchSupportedLang("en_US"), "en");
  assert.equal(matchSupportedLang("fr-FR"), null);
  assert.equal(matchSupportedLang(""), null);
});

test("detectLang følgjer nettlesarspråk til fyrste treff", () => {
  assert.equal(detectLang({ languages: ["de-DE"], storage: new MapStorage() }), "de");
  assert.equal(detectLang({ languages: ["fr-FR", "en-GB"], storage: new MapStorage() }), "en");
  assert.equal(detectLang({ languages: ["nb-NO"], storage: new MapStorage() }), "nn");
  assert.equal(detectLang({ languages: ["no-NO"], storage: new MapStorage() }), "nn");
  assert.equal(detectLang({ languages: ["sv-SE"], storage: new MapStorage() }), "nn");
});

test("lagra språkval overstyrer nettlesaren", () => {
  const storage = new MapStorage();
  storage.setItem(STORAGE_KEY, "de");
  assert.equal(detectLang({ languages: ["en-US"], storage }), "de");
});

test("setLang lagrar berre når persist er på", () => {
  const storage = new MapStorage();
  setLang("en", { persist: false, storage });
  assert.equal(storage.getItem(STORAGE_KEY), null);
  setLang("de", { persist: true, storage });
  assert.equal(storage.getItem(STORAGE_KEY), "de");
  setLang("nn");
});

test("meldingar viser publisert-tid og gyldig til med klokkeslett", () => {
  setLang("nn");
  const lines = messageTimeLines({
    publishedAt: "2026-09-02T21:38:15+02:00",
    validTo: "2026-09-03T19:37:31+00:00",
  });
  assert.equal(lines.length, 2);
  assert.match(lines[0].text, /^Publisert /);
  assert.match(lines[0].text, /21:38/);
  assert.equal(lines[0].iso, "2026-09-02T21:38:15+02:00");
  assert.match(lines[1].text, /^Gyldig til /);
  assert.match(lines[1].text, /21:37/);
  assert.equal(lines[1].iso, "2026-09-03T19:37:31+00:00");

  setLang("en");
  const en = messageTimeLines({
    publishedAt: "2026-09-02T21:38:15+02:00",
    validTo: "2026-09-03T19:37:31+00:00",
  });
  assert.match(en[0].text, /^Published /);
  assert.match(en[1].text, /^Valid until /);

  setLang("de");
  const de = messageTimeLines({
    publishedAt: "2026-09-02T21:38:15+02:00",
    validTo: "2026-09-03T19:37:31+00:00",
  });
  assert.match(de[0].text, /^Veröffentlicht /);
  assert.match(de[1].text, /^Gültig bis /);
  setLang("nn");
});

test("melding utan validTo viser berre publisert-tid", () => {
  setLang("nn");
  const lines = messageTimeLines({
    publishedAt: "2026-09-02T21:38:15+02:00",
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /^Publisert /);
  assert.match(lines[0].text, /21:38/);
});

test("melding utan publishedAt brukar validFrom", () => {
  setLang("nn");
  const lines = messageTimeLines({
    validFrom: "2026-09-02T19:38:15+00:00",
    validTo: "2026-09-03T19:37:31+00:00",
  });
  assert.equal(lines.length, 2);
  assert.match(lines[0].text, /21:38/);
  assert.match(lines[1].text, /21:37/);
});

test("meldingsfilter vis rutenummer", () => {
  setLang("nn");
  assert.equal(t("messages.filterRoute", { n: "1135" }), "Rute 1135");
  setLang("en");
  assert.equal(t("messages.filterRoute", { n: "1136" }), "Route 1136");
  setLang("de");
  assert.equal(t("messages.filterRoute", { n: "1135" }), "Linie 1135");
  setLang("nn");
});

class MapStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
}
