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
  // .stop-state held «anywhere» (normal gav 10 px sidelengs overflyt på 320 px/150 %).
  assert.match(crossing, /\.stop-state \{[^}]*overflow-wrap: anywhere/);
});

test("udatert melding (ingen slutt- eller publiseringsdato): borte når ho manglar i kjelda, seinast ved slutten av dagen (Oslo) ho fyrst vart sett", async () => {
  const { nextMessages, validMessages } = await import("../../packages/core/index.js");
  const msg = { id: "u", heading: "Standal-Trandal", text: "Rute 1136 er innstilt.", isLocal: true };
  const t0 = Date.parse("2026-10-21T09:00:00Z");
  const first = nextMessages(null, { fetchedAt: "2026-10-21T09:00:00Z", messages: [msg] }, t0);
  assert.equal(first.messages[0].firstSeenAt, "2026-10-21T09:00:00.000Z");
  // Same melding seinare: fyrste-sett-tida blir halden.
  const later = nextMessages(first, { fetchedAt: "2026-10-21T20:00:00Z", messages: [msg] }, t0 + 11 * 3600e3);
  assert.equal(later.messages[0].firstSeenAt, "2026-10-21T09:00:00.000Z");
  // Sett 11:00 Oslo 21.10: gjeld til 23:59 same dag, borte 00:01 22.10.
  assert.equal(validMessages(later.messages, Date.parse("2026-10-21T21:59:00Z")).length, 1);
  assert.equal(validMessages(later.messages, Date.parse("2026-10-21T22:01:00Z")).length, 0);
  // Borte frå kjelda: blir ikkje halden.
  const gone = nextMessages(later, { fetchedAt: "2026-10-21T21:00:00Z", messages: [] }, t0 + 12 * 3600e3);
  assert.equal(gone.messages.length, 0);
});
