import assert from "node:assert/strict";
import { test } from "node:test";
import { appVersion } from "../../tests/helpers/version.mjs";
import { fetchedInfo, isUnclearRouteMessage, messageIsHeld, messageMode, messagesPanel, routeBanner } from "../../packages/core/index.js";
const { setLang } = await import(`../../assets/i18n.js?v=${appVersion()}`);
import { readFileSync } from "node:fs";

const NOW = Date.parse("2026-10-21T09:00:00Z");
const local = (text, over = {}) => ({ id: text, heading: "Standal-Trandal-Valderøya-Store Kalvøy", text, isLocal: true, publishedAt: "2026-10-21T08:00:00+02:00", ...over });

test("tabellbyte berre ved tydelege signal; «1136 innstilt» utan liste blir banner", () => {
  assert.equal(messageMode(local("Rute 1136: kombinert rute i dag.")), "kombi");
  assert.equal(messageMode(local("Rute 1136 er innstilt inntil vidare.")), "1136");
  assert.equal(messageMode(local("x", { routeMode: "1135" })), "1136");
  assert.equal(messageMode(local("Rute 1135 og 1136 innstilt.")), "1136");
  assert.equal(isUnclearRouteMessage(local("Rute 1136 er innstilt inntil vidare.")), true);
  assert.equal(isUnclearRouteMessage(local("Rute 1136: kombinert rute.")), false);
  assert.equal(isUnclearRouteMessage(local("Det er normal drift i sambandet.")), false);
  assert.equal(isUnclearRouteMessage(local("Følgjande avgangar innstilt: 20:00 frå Standal")), false);
  const banner = routeBanner([local("Rute 1136 er innstilt inntil vidare.")], NOW);
  assert.equal(banner.text, "Rute 1136 er innstilt inntil vidare.");
  assert.equal(banner.href, "https://www.fjord1.no/trafikkmeldingar");
  assert.equal(routeBanner([local("Rute 1136: kombinert rute.")], NOW), null);
});

test("melding utan sluttdato fell bort seinast ved dagsslutt", () => {
  const msg = local("Rute 1136 er innstilt.");
  assert.equal(messageIsHeld(msg, NOW), true);
  assert.equal(messageIsHeld(msg, Date.parse("2026-10-21T21:59:00Z")), true);
  assert.equal(messageIsHeld(msg, Date.parse("2026-10-21T22:01:00Z")), false);
  assert.equal(messageIsHeld({ ...msg, validTo: "2026-10-25T21:59:00Z" }, Date.parse("2026-10-23T10:00:00Z")), true);
});

test("panelet: «Meldingar henta HH:MM», åtvaring etter 15 min, og banner", () => {
  setLang("nn", { persist: false });
  const payload = { fetchedAt: "2026-10-21T08:50:00Z", messages: [local("Rute 1136 er innstilt inntil vidare.")] };
  const fresh = messagesPanel(payload, "local", "1136", NOW);
  assert.equal(fresh.fetchedText, "Meldingar henta 10:50");
  assert.equal(fresh.fetchedOld, false);
  assert.ok(fresh.banner);
  const old = fetchedInfo(payload, Date.parse("2026-10-21T09:06:00Z"));
  assert.equal(old.fetchedOld, true);
  assert.match(old.fetchedText, /^Meldingar henta 10:50\. Dei kan vere utdaterte/);
});

test("bygget tek ikkje med data/trafikkmeldinger.json; stadnamn blir ikkje delte midt i ordet", async () => {
  const { NOT_IN_BUILD } = await import("../build/repo-data.js");
  assert.ok(NOT_IN_BUILD.has("trafikkmeldinger.json"));
  const css = readFileSync(new URL("../src/styles/nowcard.css", import.meta.url), "utf8");
  assert.match(css, /\.na-quays > span \{[^}]*overflow-wrap: normal/);
  assert.doesNotMatch(css, /is-before \.na-quays/);
  const crossing = readFileSync(new URL("../src/styles/crossing.css", import.meta.url), "utf8");
  assert.doesNotMatch(crossing, /\.stop-state \{[^}]*anywhere/);
});
