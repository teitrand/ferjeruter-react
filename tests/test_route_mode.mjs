import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";
import {
  buildEvents,
  ferryStatus,
  isPreview,
  legsForDate,
  legsForPlaceFilter,
  matchesStop,
  resetTestState,
  routeOverride,
  quayAtStart,
  switchOverride,
  setTestState,
  visibleConnectionLines,
  connectionIndex,
  connectionNote,
  readHideArrivals,
  readRouteChoice,
  showArrivals,
  signalPhone,
  vesselNameForTable,
  writeHideArrivals,
  writeRouteChoice,
  chosenRoute,
  operationalMode,
  activeMode,
  TIMETABLE_CACHE_KEY,
  MESSAGES_CACHE_KEY,
  readCachedTimetable,
  readCachedMessages,
  readLastMode,
  writeCachedTimetable,
  writeCachedMessages,
  writeLastMode,
  hydrateCachedMessages,
  applyMessageFilter,
  usefulMessageFilters,
  matchesChosenRouteNotice,
  messagesUrl,
  signalLogUrl,
  isCancelledDeparture,
} from "../assets/app.js";
import {
  dayType,
  passengerJourneysFrom,
  modeFromText,
  quayPlace,
  quaysInDay,
  resolveRoutePlan,
  switchFromText,
  windowFromText,
  vesselFromText,
  telHref,
  timetableFingerprint,
  messagesFingerprint,
  isRouteControl,
  cancelledSailingsFromText,
  isPartialCancel,
  classifyMessage,
  mergeMessagePayloads,
  messagesAreStale,
  messageIsHeld,
  retainHeldMessages,
  MESSAGES_STALE_MS,
  normalizeFjord1Node,
  parseFjord1Published,
  parseFjord1TrafficHtml,
} from "../packages/core/index.js";

/** Samanfatning av resolveRoutePlan: berre modusen. */
const routeModeFromMessages = (messages, now, date) => resolveRoutePlan(messages, now, date).mode;

// Fast kopi av rutetabellen (henta 2026-10-02). data/ruter.json rullar datovindauget
// fram kvar dag, så testar med faste datoar ville slutta å finne avgangane.
const ruter = JSON.parse(
  readFileSync(new URL("./fixtures/ruter.json", import.meta.url), "utf8")
);
const kombi = JSON.parse(
  readFileSync(new URL("../data/kombirute.json", import.meta.url), "utf8")
);

const SMS =
  "Grunna driftsproblem så er ferjerutene 1135 og 1136 innstilt, det blir utført kombinasjonsrute med MF Kvernes. Første avgang frå Sæbø ca. 08:15. Sjå rutetabell på frammr.no.";

const WEEKDAY = "2026-10-01";

beforeEach(() => resetTestState());

test("SMS-døme blir kombi", () => {
  assert.equal(modeFromText(SMS), "kombi");
});

test("normal drift med falsk innstilt blir 1136", () => {
  assert.equal(
    modeFromText(
      "Rute 1136 Standal-Trandal: Pga ein feil i rutesøket vise at det er innstilt, men det er normal drift."
    ),
    "1136"
  );
});

test("berre 1136 innstilt blir 1135", () => {
  assert.equal(modeFromText("Rute 1136 Standal-Trandal er innstilt inntil vidare."), "1135");
});

test("datoar i meldinga styrer når kombiruta gjeld", () => {
  const kombiMsg = {
    isLocal: true,
    isRouteControl: true,
    heading: "Standal-Trandal",
    text: "Grunna verkstadopphald vert det køyrt kombinert rute frå 14.06 til 18.06.",
    routeMode: "kombi",
    routeWindow: { from: "2026-06-14", to: "2026-06-18" },
    publishedAt: "2026-06-12T09:00:00+02:00",
    validTo: "2026-06-30T21:59:00Z",
  };
  const normalMsg = {
    isLocal: true,
    isRouteControl: true,
    text: "Det vert normal drift i sambandet frå rutestart fredag 05.06.",
    routeMode: "1136",
    routeWindow: { from: "2026-06-05", to: null },
    publishedAt: "2026-06-04T22:40:00+02:00",
    validTo: "2026-06-30T21:59:00Z",
  };
  const messages = [kombiMsg, normalMsg];
  assert.deepEqual(windowFromText(kombiMsg.text, kombiMsg.publishedAt), {
    from: "2026-06-14",
    to: "2026-06-18",
  });
  assert.equal(
    routeModeFromMessages(messages, Date.parse("2026-06-12T10:00:00+02:00"), "2026-06-12"),
    "1136"
  );
  assert.equal(
    routeModeFromMessages(messages, Date.parse("2026-06-15T10:00:00+02:00"), "2026-06-15"),
    "kombi"
  );
  assert.equal(
    routeModeFromMessages(messages, Date.parse("2026-06-19T10:00:00+02:00"), "2026-06-19"),
    "1136"
  );
});

test("nynorsk måndag i datoperioden startar ikkje kombiruta for tidleg", () => {
  const text =
    "Rute 1136 Standal-Trandal-Valderøya-Store Kalvøy: På grunn av planlagt verkstedopphald blir det utført kombinert rute i sambandet frå måndag 14.09 til og med fredag 18.09. Det blir MF Geiranger i rute (91669321).";
  assert.deepEqual(windowFromText(text, "2026-09-11T10:00:00+02:00"), {
    from: "2026-09-14",
    to: "2026-09-18",
  });
  const msg = normalizeFjord1Node({
    heading: "Standal-Trandal-Valderøya-Store Kalvøy",
    content: text,
    date: "11.09.2026, kl. 10:00",
  });
  assert.equal(msg.routeMode, "kombi");
  assert.deepEqual(msg.routeWindow, { from: "2026-09-14", to: "2026-09-18" });
  assert.equal(
    routeModeFromMessages([msg], Date.parse("2026-09-13T16:00:00Z"), "2026-09-13"),
    "1136"
  );
  assert.equal(
    routeModeFromMessages([msg], Date.parse("2026-09-14T08:00:00Z"), "2026-09-14"),
    "kombi"
  );
});

test("Fjord1 24-timars validTo blir halden ut Oslo-dagen", () => {
  const extra = normalizeFjord1Node({
    heading: "Standal-Trandal-Valderøya-Store Kalvøy",
    content:
      "Rute 1136 Standal-Trandal-Valderøya-Store Kalvøy: Grunna utvida verkstedopphald blir det kombinert rute også på laurdag 19.09. MF Geiranger (tlf. 91669321) i rute. For rutetider sjå frammr.no.",
    date: "18.09.2026 07:59:22",
    countyNumber: 15,
    connectionNumber: 132,
    validFrom: { timestamp: 1789711162 },
    validTo: { timestamp: 1789797550 },
  });
  const saturdayAfternoon = Date.parse("2026-09-19T13:00:00+02:00");
  const sundayMorning = Date.parse("2026-09-20T08:00:00+02:00");
  assert.equal(messageIsHeld(extra, saturdayAfternoon), true);
  assert.equal(messageIsHeld(extra, sundayMorning), false);
  assert.equal(routeModeFromMessages([extra], saturdayAfternoon, "2026-09-19"), "kombi");
  assert.equal(routeModeFromMessages([extra], sundayMorning, "2026-09-20"), "1136");
});

test("komplett live-feed droppar ikkje haldne lokale meldingar", () => {
  const extra = normalizeFjord1Node({
    heading: "Standal-Trandal-Valderøya-Store Kalvøy",
    content:
      "Rute 1136 Standal-Trandal-Valderøya-Store Kalvøy: Grunna utvida verkstedopphald blir det kombinert rute også på laurdag 19.09. MF Geiranger (tlf. 91669321) i rute. For rutetider sjå frammr.no.",
    date: "18.09.2026 07:59:22",
    countyNumber: 15,
    connectionNumber: 132,
    validFrom: { timestamp: 1789711162 },
    validTo: { timestamp: 1789797550 },
  });
  const other = {
    id: "oldeide",
    heading: "Oldeide-Måløy",
    text: "Rute 1039: kansellerte avganger.",
    publishedAt: "2026-09-18T14:49:36+02:00",
    validTo: "2026-09-19T12:48:57+00:00",
    isLocal: false,
  };
  const saturdayAfternoon = Date.parse("2026-09-19T13:00:00+02:00");
  const live = {
    source: "https://www.fjord1.no/trafikkmeldingar",
    fetchedAt: "2026-09-19T11:00:00.000Z",
    fetchedLive: true,
    complete: true,
    messages: [other],
  };
  const base = {
    source: "https://www.fjord1.no/trafikkmeldingar",
    fetchedAt: "2026-09-18T23:36:50.000Z",
    messages: [extra, other],
  };
  const merged = mergeMessagePayloads(base, live, saturdayAfternoon);
  assert.equal(merged.complete, true);
  assert.ok(merged.messages.some((msg) => msg.routeMode === "kombi"));
  assert.ok(merged.messages.some((msg) => msg.heading === "Oldeide-Måløy"));
  assert.equal(routeModeFromMessages(merged.messages, saturdayAfternoon, "2026-09-19"), "kombi");

  const dropped = retainHeldMessages([other], [extra], saturdayAfternoon);
  assert.ok(dropped.some((msg) => msg.routeMode === "kombi"));
  const sunday = retainHeldMessages([other], [extra], Date.parse("2026-09-20T08:00:00+02:00"));
  assert.equal(
    sunday.some((msg) => /kombinert rute/.test(msg.text || "")),
    false
  );
});

test("Fjord1 «også på laurdag» held kombiruta etter CMS-gyldigheita", () => {
  const extraText =
    "Rute 1136 Standal-Trandal-Valderøya-Store Kalvøy: Grunna utvida verkstedopphald blir det kombinert rute også på laurdag 19.09. MF Geiranger (tlf. 91669321) i rute. For rutetider sjå frammr.no.";
  assert.deepEqual(windowFromText(extraText, "2026-09-18T07:59:22+02:00"), {
    from: null,
    to: "2026-09-19",
  });
  const extra = normalizeFjord1Node({
    heading: "Standal-Trandal-Valderøya-Store Kalvøy",
    content: extraText,
    date: "18.09.2026 07:59:22",
    countyNumber: 15,
    connectionNumber: 132,
    validFrom: { timestamp: 1789711162 },
    validTo: { timestamp: 1789797550 },
  });
  assert.equal(extra.routeMode, "kombi");
  assert.equal(extra.vessel, "Geiranger");
  assert.deepEqual(extra.routeWindow, { from: null, to: "2026-09-19" });

  const planned = normalizeFjord1Node({
    heading: "Standal-Trandal-Valderøya-Store Kalvøy",
    content:
      "Rute 1136 Standal-Trandal-Valderøya-Store Kalvøy: På grunn av planlagt verkstedopphald blir det utført kombinert rute i sambandet frå måndag 14.09 til og med fredag 18.09. Det blir MF Geiranger i rute (91669321). Rutetabell finn du på frammr.no",
    date: "11.09.2026 09:57:53",
    countyNumber: 15,
    connectionNumber: 132,
    validFrom: { timestamp: 1789113420 },
    validTo: { timestamp: 1789768500 },
  });
  const messages = [extra, planned];
  const saturdayAfternoon = Date.parse("2026-09-19T12:00:00+02:00");
  assert.equal(routeModeFromMessages(messages, saturdayAfternoon, "2026-09-18"), "kombi");
  assert.equal(routeModeFromMessages(messages, saturdayAfternoon, "2026-09-19"), "kombi");
  assert.equal(routeModeFromMessages(messages, saturdayAfternoon, "2026-09-20"), "1136");

  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: "2026-09-19",
    routeChoice: "1136",
    messages: {
      messages: messages.map((msg) => ({ ...msg, validTo: "2099-01-01T00:00:00Z" })),
    },
  });
  assert.equal(operationalMode("2026-09-19"), "kombi");
  const saturday = legsForDate("2026-09-19");
  assert.ok(saturday.every((leg) => leg.table === "kombi"));
  assert.equal(saturday[0].from, "Sæbø");
  assert.equal(saturday[0].departure, "06:30:00");
  assert.equal(vesselNameForTable("kombi"), "Geiranger");
});

test("normal drift frå rutestart byter ikkje tabell dagen før", () => {
  const messages = [
    {
      isLocal: true,
      isRouteControl: true,
      text: "Det vert normal drift i sambandet frå rutestart fredag 05.06.",
      routeMode: "1136",
      routeWindow: { from: "2026-06-05", to: null },
      publishedAt: "2026-06-04T22:40:00+02:00",
      validTo: "2026-06-20T21:59:00Z",
    },
    {
      isLocal: true,
      isRouteControl: true,
      text: "Grunna verkstadopphald vert det køyrt kombinert rute.",
      routeMode: "kombi",
      publishedAt: "2026-06-03T12:00:00+02:00",
      validTo: "2026-06-20T21:59:00Z",
    },
  ];
  assert.equal(
    routeModeFromMessages(messages, Date.parse("2026-06-04T22:50:00+02:00"), "2026-06-04"),
    "kombi"
  );
  assert.equal(
    routeModeFromMessages(messages, Date.parse("2026-06-05T08:00:00+02:00"), "2026-06-05"),
    "1136"
  );
});

test("normal drift frå klokka skøyt mot førre modus same dag", () => {
  const messages = [
    {
      isLocal: true,
      isRouteControl: true,
      text: "Det vert normal drift i sambandet frå kl. 21:00.",
      routeMode: "1136",
      activateAt: "21:00:00",
      publishedAt: "2026-04-07T16:00:00+02:00",
      validTo: "2026-04-10T21:59:00Z",
    },
    {
      isLocal: true,
      isRouteControl: true,
      text: "Rute 1136 Standal-Trandal er innstilt inntil vidare.",
      routeMode: "1135",
      publishedAt: "2026-04-07T08:00:00+02:00",
      validTo: "2026-04-10T21:59:00Z",
    },
  ];
  const day = resolveRoutePlan(messages, Date.parse("2026-04-07T16:10:00+02:00"), "2026-04-07");
  assert.equal(day.mode, "1136");
  assert.deepEqual(day.switch, {
    time: "21:00:00",
    quay: null,
    before: "1135",
    after: "1136",
    acute: null,
  });
  const next = resolveRoutePlan(messages, Date.parse("2026-04-08T10:00:00+02:00"), "2026-04-08");
  assert.equal(next.mode, "1136");
  assert.equal(next.switch, null);
});

test("1049-melding styrer ikkje 1136-tabellen", () => {
  const messages = [
    {
      isLocal: true,
      isRouteControl: false,
      heading: "Hundeidvika – Festøya",
      text: "Rute 1049: innstilt frå kl. 10:30 til 13:25.",
      routeMode: "1136",
      publishedAt: "2026-05-20T08:00:00+02:00",
      validTo: "2026-05-21T21:59:00Z",
    },
    {
      isLocal: true,
      isRouteControl: true,
      text: "Grunna verkstadopphald vert det køyrt kombinert rute.",
      routeMode: "kombi",
      publishedAt: "2026-05-19T12:00:00+02:00",
      validTo: "2026-05-21T21:59:00Z",
    },
  ];
  assert.equal(
    routeModeFromMessages(messages, Date.parse("2026-05-20T11:00:00+02:00"), "2026-05-20"),
    "kombi"
  );
  assert.equal(switchFromText(messages[0].text), null);
});

test("normal drift frå klokka skøyt tabellen same dag", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: WEEKDAY,
    messages: {
      messages: [
        {
          isLocal: true,
          isRouteControl: true,
          text: "Det vert normal drift i sambandet frå kl. 14:00.",
          routeMode: "1136",
          activateAt: "14:00:00",
          publishedAt: `${WEEKDAY}T10:00:00+02:00`,
          validTo: "2099-01-01T00:00:00Z",
        },
        {
          isLocal: true,
          isRouteControl: true,
          text: "Rute 1136 Standal-Trandal er innstilt inntil vidare.",
          routeMode: "1135",
          publishedAt: `${WEEKDAY}T08:00:00+02:00`,
          validTo: "2099-01-01T00:00:00Z",
        },
      ],
    },
  });
  const legs = legsForDate(WEEKDAY);
  assert.ok(legs.some((leg) => leg.table === "1135" && leg.departure < "14:00:00"));
  assert.ok(legs.some((leg) => leg.table === "1136" && leg.departure >= "14:00:00"));
  assert.ok(legs.every((leg) => !(leg.table === "1136" && leg.departure < "14:00:00")));
  assert.ok(legs.every((leg) => !(leg.table === "1135" && leg.departure >= "14:00:00")));
});

test("enskild kansellert avgang skøyt ikkje til 1135", () => {
  assert.equal(
    switchFromText(
      "Rute 1136: Avgang kl. 14:25 frå Trandal blir kansellert. Normal drift frå kl. 14:50."
    ),
    null
  );
  const plan = resolveRoutePlan(
    [
      {
        isLocal: true,
        isRouteControl: true,
        text: "Rute 1136: Avgang kl. 14:25 frå Trandal blir kansellert. Normal drift frå kl. 14:50.",
        routeMode: "1136",
        activateAt: "14:50:00",
        publishedAt: "2026-04-23T09:00:00+02:00",
        validTo: "2026-04-24T21:59:00Z",
      },
    ],
    Date.parse("2026-04-23T10:00:00+02:00"),
    "2026-04-23"
  );
  assert.equal(plan.mode, "1136");
  assert.equal(plan.switch, null);
});

const KVILE_SMS =
  "FJORD1 Rute 1136 Standal-Trandal-Valderøya-Store Kalvøy (www.Fjord1.no):  Grunna kviletidsbestemmelser og pålagt kvile til mannskapet vert følgjande avgangar innstilt: 20:00 og 20:40 frå Standal, 20:20 og 21:00 frå Trandal";

test("innstilte kveldsavgangar skøyt ikkje til 1135, men merkar turane", () => {
  assert.equal(modeFromText(KVILE_SMS), "1136");
  assert.equal(modeFromText("Rute 1136 Standal-Trandal er innstilt inntil vidare."), "1135");
  assert.ok(isPartialCancel(KVILE_SMS));
  assert.equal(
    isRouteControl({
      heading: "Standal-Trandal-Valderøya-Store Kalvøy",
      text: KVILE_SMS,
      isLocal: true,
      isRouteControl: true,
      routeMode: "1135",
    }),
    false
  );
  assert.deepEqual(cancelledSailingsFromText(KVILE_SMS), [
    { time: "20:00:00", from: "Standal" },
    { time: "20:40:00", from: "Standal" },
    { time: "20:20:00", from: "Trandal" },
    { time: "21:00:00", from: "Trandal" },
  ]);

  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: "2026-10-04",
    routeChoice: "1136",
    messages: {
      messages: [
        {
          heading: "Standal-Trandal-Valderøya-Store Kalvøy",
          text: KVILE_SMS,
          isLocal: true,
          isRouteControl: true,
          routeMode: "1135",
          publishedAt: "2026-09-13T17:50:00+02:00",
          validTo: "2099-01-01T00:00:00Z",
        },
      ],
    },
  });
  assert.equal(operationalMode("2026-10-04"), "1136");
  assert.equal(activeMode(), "1136");
  const legs = legsForDate("2026-10-04");
  const standal2000 = legs.find((leg) => leg.from === "Standal" && leg.departure === "20:00:00");
  const trandal2020 = legs.find((leg) => leg.from === "Trandal" && leg.departure === "20:20:00");
  const standal2040 = legs.find((leg) => leg.from === "Standal" && leg.departure === "20:40:00");
  const trandal2100 = legs.find((leg) => leg.from === "Trandal" && leg.departure === "21:00:00");
  const earlier = legs.find((leg) => leg.from === "Standal" && leg.departure === "10:00:00");
  assert.ok(standal2000);
  assert.ok(isCancelledDeparture(standal2000));
  assert.ok(isCancelledDeparture(trandal2020));
  assert.ok(isCancelledDeparture(standal2040));
  assert.ok(isCancelledDeparture(trandal2100));
  assert.equal(isCancelledDeparture(earlier), false);
});

test("nyaste lokale melding styrer modus", () => {
  assert.equal(
    routeModeFromMessages(
      [
        {
          isLocal: true,
          text: SMS,
          routeMode: "kombi",
          validTo: "2099-01-01T00:00:00Z",
        },
      ],
      Date.parse("2026-08-28T10:00:00Z")
    ),
    "kombi"
  );
  assert.equal(
    routeModeFromMessages(
      [
        {
          isLocal: true,
          text: "normal drift",
          routeMode: "1136",
          validTo: "2099-01-01T00:00:00Z",
        },
      ],
      Date.parse("2026-08-28T10:00:00Z")
    ),
    "1136"
  );
});

function useKombi() {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    messages: {
      messages: [{ isLocal: true, text: SMS, routeMode: "kombi", validTo: "2099-01-01T00:00:00Z" }],
    },
  });
}

function clockMin(time) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function jsonFromKeys(kind) {
  return new Set(
    kombi.legs
      .filter((leg) => leg.days.includes(kind))
      .map((leg) => `${leg.from}|${clockMin(leg.departure)}`)
  );
}

const KOMBI_DATES = { weekday: WEEKDAY, saturday: "2026-08-29", sunday: "2026-08-30" };

test("kombirute har dei fem PDF-stoppa, ikkje 1136-kaiar", () => {
  useKombi();
  assert.equal(dayType(WEEKDAY), "weekday");
  const quays = quaysInDay(legsForDate(WEEKDAY));
  assert.ok(quays.includes("Leknes"));
  assert.ok(quays.includes("Sæbø"));
  assert.ok(!quays.includes("Valderøya"));
  assert.ok(!quays.includes("Store Kalvøy"));
});

test("1136-modus har ikkje Leknes-bein", () => {
  setTestState({ routes: ruter, kombirute: kombi, messages: { messages: [] } });
  const legs = legsForDate(WEEKDAY);
  assert.ok(legs.length > 0);
  assert.ok(legs.every((leg) => leg.from !== "Leknes" && leg.to !== "Leknes"));
});

test("Skår til Standal visest som reise med mellomstopp", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: WEEKDAY,
    routeChoice: "1136",
    messages: { messages: [] },
    fromFilter: "Skår",
    toFilter: "Standal",
  });
  const events = buildEvents(legsForDate(WEEKDAY), null).filter((event) => event.kind === "dep");
  assert.ok(events.length >= 3);
  assert.equal(events[0].leg.from, "Skår");
  assert.equal(events[events.length - 1].leg.to, "Standal");
  assert.ok(events.some((event) => event.leg.from === "Sæbø"));
  assert.ok(events.some((event) => event.leg.from === "Trandal"));
});

test("Leknes til Standal byter ferje på Sæbø i normal rute", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: WEEKDAY,
    routeChoice: "1136",
    messages: { messages: [] },
    fromFilter: "Leknes",
    toFilter: "Standal",
  });
  const legs = legsForPlaceFilter(WEEKDAY);
  assert.ok(legs.some((leg) => leg.from === "Leknes"));
  const journeys = passengerJourneysFrom(legs, "Leknes", "Standal");
  assert.ok(journeys.length >= 1);
  assert.ok(journeys.every((journey) => journey.transfer));
  const first = journeys[0].legs;
  assert.equal(first[0].from, "Leknes");
  assert.equal(first[first.length - 1].to, "Standal");
  assert.ok(first.some((leg) => leg.to === "Sæbø"));
  const events = buildEvents(legs, null).filter((event) => event.kind === "dep");
  assert.ok(events.some((event) => event.leg.from === "Leknes"));
  assert.ok(events.some((event) => event.leg.to === "Standal"));
  assert.equal(events.find((event) => event.leg.from === "Leknes").onward, false);
  const onward = events.filter((event) => event.leg.from !== "Leknes");
  assert.ok(onward.length > 0);
  assert.ok(onward.every((event) => event.onward));
  const waits = buildEvents(legs, null).filter((event) => event.kind === "wait");
  assert.ok(waits.length > 0);
  assert.ok(waits.every((event) => event.onward));
});

test("direkte avgang frå filteret er ikkje innrykka", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: WEEKDAY,
    routeChoice: "1136",
    messages: { messages: [] },
    fromFilter: "Standal",
    toFilter: "Trandal",
  });
  const events = buildEvents(legsForPlaceFilter(WEEKDAY), null).filter((event) => event.kind === "dep");
  assert.ok(events.length > 0);
  assert.ok(events.every((event) => event.leg.from === "Standal" && event.onward === false));
});

test("kombirute Standal til Skår ventar på Sæbø utan Leknes-pendel", () => {
  useKombi();
  setTestState({ date: WEEKDAY, fromFilter: "Standal", toFilter: "Skår" });
  const journeys = passengerJourneysFrom(legsForDate(WEEKDAY), "Standal", "Skår");
  const afternoon = journeys.find((journey) => journey.legs[0].departure === "15:50:00");
  assert.ok(afternoon);
  assert.ok(afternoon.wait);
  assert.equal(afternoon.wait.quay, "Sæbø");
  assert.equal(afternoon.wait.minutes, 65);
  assert.deepEqual(
    afternoon.legs.map((part) => `${part.from}→${part.to}`),
    ["Standal→Trandal", "Trandal→Sæbø", "Sæbø→Leknes", "Leknes→Skår"]
  );
});

test("Øye-korrespondanse visest ikkje, destinasjonar på Sæbø visest når båe ferjene køyrer", () => {
  const connections = {
    hub: "Festøya",
    roadTo: "Standal",
    lines: [
      { id: "solavagen", label: "Solavågen", hub: "Festøya", roadTo: "Standal" },
      { id: "oye", label: "Øye", hub: "Leknes", roadTo: "Leknes" },
    ],
  };
  setTestState({
    routes: ruter,
    kombirute: kombi,
    connections,
    date: WEEKDAY,
    messages: { messages: [] },
  });
  const ids1136 = visibleConnectionLines(legsForDate(WEEKDAY)).map((line) => line.id);
  assert.deepEqual(ids1136, ["saebo-trandal", "saebo-standal", "saebo-skar", "solavagen"]);
  assert.ok(!ids1136.includes("oye"));
  assert.ok(!ids1136.includes("saebo"));

  setTestState({
    messages: {
      messages: [
        { isLocal: true, text: SMS, routeMode: "kombi", validTo: "2099-01-01T00:00:00Z" },
      ],
    },
  });
  const idsKombi = visibleConnectionLines(legsForDate(WEEKDAY)).map((line) => line.id);
  assert.ok(!idsKombi.includes("saebo-trandal"));
  assert.ok(!idsKombi.includes("saebo-standal"));
  assert.ok(!idsKombi.includes("saebo-skar"));
  assert.ok(!idsKombi.includes("oye"));
  assert.ok(idsKombi.includes("solavagen"));
});

test("byte mot Trandal koplar 1136-ankomst til neste 1135", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: WEEKDAY,
    routeChoice: "1136",
    connection: "saebo-trandal",
    messages: { messages: [] },
  });
  const index = connectionIndex(WEEKDAY);
  assert.equal(index.hub, "Sæbø");
  assert.equal(index.other, "1135");
  assert.equal(index.dest, "Trandal");
  const toSaebo = { from: "Trandal", to: "Sæbø", departure: "08:00:00", arrival: "08:30:00" };
  assert.equal(connectionNote(index, "arr", toSaebo), "Vidare 09:15 frå Sæbø mot Leknes");
  const fromSkar = { from: "Sæbø", to: "Skår", departure: "08:35:00", arrival: "08:55:00" };
  assert.equal(connectionNote(index, "dep", fromSkar), null);
});

test("byte mot Skår merkar signaltur når ein kjem frå Leknes", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: WEEKDAY,
    routeChoice: "1136",
    connection: "saebo-skar",
    messages: { messages: [] },
  });
  const index = connectionIndex(WEEKDAY);
  const fromSaebo = { from: "Sæbø", to: "Skår", departure: "08:35:00", arrival: "08:55:00" };
  assert.equal(connectionNote(index, "dep", fromSaebo), "Ta ferja 07:30 frå Leknes for å rekke denne");

  setTestState({ routeChoice: "1135", connection: "saebo-skar" });
  const toSkar = connectionIndex(WEEKDAY);
  assert.equal(toSkar.other, "1136");
  assert.equal(toSkar.dest, "Skår");
  const fromLeknes = { from: "Leknes", to: "Sæbø", departure: "07:30:00", arrival: "07:43:00" };
  assert.equal(
    connectionNote(toSkar, "arr", fromLeknes),
    "Vidare 08:35 frå Sæbø mot Skår. Signaltur, ring 1136 (916 69 340)"
  );
  const laterLeknes = { from: "Leknes", to: "Sæbø", departure: "08:30:00", arrival: "08:43:00" };
  assert.equal(
    connectionNote(toSkar, "arr", laterLeknes),
    "Vidare 16:50 frå Sæbø mot Skår. Signaltur, ring 1136 (916 69 340)"
  );
});

test("byte mot Standal følgjer same segling via Trandal og merkar signaltur", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: WEEKDAY,
    routeChoice: "1135",
    connection: "saebo-standal",
    messages: { messages: [] },
  });
  const index = connectionIndex(WEEKDAY);
  assert.equal(index.dest, "Standal");
  const fromLeknes = { from: "Leknes", to: "Sæbø", departure: "08:30:00", arrival: "08:43:00" };
  assert.equal(
    connectionNote(index, "arr", fromLeknes),
    "Vidare 09:20 frå Sæbø mot Standal. Signaltur, ring 1136 (916 69 340)"
  );

  setTestState({ connection: "saebo-trandal" });
  const toTrandal = connectionIndex(WEEKDAY);
  assert.equal(
    connectionNote(toTrandal, "arr", fromLeknes),
    "Vidare 09:20 frå Sæbø mot Trandal. Signaltur, ring 1136 (916 69 340)"
  );

  setTestState({ routeChoice: "1136", connection: "saebo-standal" });
  const fromTrandalLeg = {
    from: "Sæbø",
    to: "Trandal",
    departure: "09:20:00",
    arrival: "09:45:00",
  };
  assert.equal(
    connectionNote(connectionIndex(WEEKDAY), "dep", fromTrandalLeg),
    "Ta ferja 08:30 frå Leknes for å rekke denne"
  );
});

test("frå klokka skøyt to tabellar, kai kjem frå tabellen", () => {
  const text = "Kombirute vert utført frå klokka 08:15. 1135 og 1136 innstilt etter det.";
  assert.deepEqual(switchFromText(text), {
    time: "08:15:00",
    quay: null,
    before: "1136",
    after: "kombi",
    acute: null,
  });
  assert.equal(switchFromText(SMS), null);
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: WEEKDAY,
    messages: {
      messages: [
        {
          isLocal: true,
          text,
          routeMode: "kombi",
          routeSwitch: switchFromText(text),
          validTo: "2099-01-01T00:00:00Z",
        },
      ],
    },
  });
  assert.equal(quayAtStart("kombi", WEEKDAY, "08:15:00"), "Sæbø");
  const legs = legsForDate(WEEKDAY);
  assert.ok(legs.some((leg) => leg.table === "1136" && leg.departure === "07:40:00"));
  assert.ok(legs.every((leg) => !(leg.table === "1136" && leg.departure >= "08:15:00")));
  assert.ok(legs.every((leg) => !(leg.table === "kombi" && leg.departure < "08:15:00")));
  const start = legs.find(
    (leg) => leg.table === "kombi" && leg.from === "Sæbø" && leg.departure === "08:15:00"
  );
  assert.ok(start);
  assert.equal(start.to, "Leknes");
  const events = buildEvents(legs, null);
  const split = events.filter((event) => event.kind === "split");
  assert.equal(split.length, 1);
  assert.equal(split[0].at, 8 * 60 + 15);
  assert.ok(events.every((event) => event.kind !== "transfer"));
});

test("usikre avgangar er berre hol mellom melding og start", () => {
  const text = "Kombirute vert utført frå klokka 08:15.";
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: WEEKDAY,
    messages: {
      messages: [
        {
          isLocal: true,
          text,
          routeMode: "kombi",
          routeSwitch: switchFromText(text),
          publishedAt: `${WEEKDAY}T07:00:00+02:00`,
          validTo: "2099-01-01T00:00:00Z",
        },
      ],
    },
  });
  const legs = legsForDate(WEEKDAY);
  assert.ok(legs.some((leg) => leg.table === "1136" && leg.departure === "06:45:00"));
  assert.ok(legs.every((leg) => !(leg.table === "1136" && leg.departure > "07:00:00")));
  assert.ok(legs.every((leg) => !(leg.table === "kombi" && leg.departure < "08:15:00")));
  assert.ok(legs.some((leg) => leg.from === "Sæbø" && leg.departure === "08:15:00"));
  assert.equal(buildEvents(legs, null).filter((event) => event.kind === "split").length, 1);
});

test("melding dagen før gjev heile fyrste tabellen", () => {
  const text = "Kombirute vert utført frå klokka 08:15.";
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: WEEKDAY,
    messages: {
      messages: [
        {
          isLocal: true,
          text,
          routeMode: "kombi",
          routeSwitch: switchFromText(text),
          publishedAt: "2026-08-27T20:00:00+02:00",
          validTo: "2099-01-01T00:00:00Z",
        },
      ],
    },
  });
  const legs = legsForDate(WEEKDAY);
  assert.ok(legs.some((leg) => leg.table === "1136" && leg.departure === "07:40:00"));
});

test("?frå= på /dev/ set skøyt utan melding", () => {
  assert.deepEqual(
    switchOverride({
      hostname: "localhost",
      pathname: "/",
      href: "http://localhost:8080/?rute=kombi&frå=14:00&kai=Standal",
    }),
    { time: "14:00:00", quay: null, before: "1136", after: "kombi", notice: null, acute: null }
  );
  assert.equal(
    switchOverride({
      hostname: "teitrand.github.io",
      pathname: "/fergeruter/",
      href: "https://teitrand.github.io/fergeruter/?rute=kombi&frå=14:00",
    }),
    null
  );
});

test("testhost hentar trafikkmeldingar frå produksjon, localhost og prod les lokalt", () => {
  assert.equal(
    messagesUrl({
      hostname: "teitrand.github.io",
      pathname: "/fergeruter/dev/",
      href: "https://teitrand.github.io/fergeruter/dev/",
    }),
    "https://teitrand.github.io/fergeruter/data/trafikkmeldinger.json"
  );
  assert.equal(
    messagesUrl({
      hostname: "teitrand.github.io",
      pathname: "/fergeruter/dev/index.html",
      href: "https://teitrand.github.io/fergeruter/dev/index.html",
    }),
    "https://teitrand.github.io/fergeruter/data/trafikkmeldinger.json"
  );
  assert.equal(
    messagesUrl({
      hostname: "localhost",
      pathname: "/",
      href: "http://localhost:8080/",
    }),
    "data/trafikkmeldinger.json"
  );
  assert.equal(
    messagesUrl({
      hostname: "teitrand.github.io",
      pathname: "/fergeruter/",
      href: "https://teitrand.github.io/fergeruter/",
    }),
    "data/trafikkmeldinger.json"
  );
  assert.equal(
    signalLogUrl({
      hostname: "teitrand.github.io",
      pathname: "/fergeruter/dev/",
      href: "https://teitrand.github.io/fergeruter/dev/",
    }),
    "https://teitrand.github.io/fergeruter/data/signalturar.json"
  );
});

test("sida har ikkje statusbanner over innhaldet", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /id="status-banner"/);
  assert.doesNotMatch(html, /class="status-banner"/);
});

test("?rute= verkar på førehandsvisinga av React-skalet, men ikkje på eige domene", () => {
  const at = (href) => {
    const url = new URL(href);
    return { hostname: url.hostname, pathname: url.pathname, href };
  };
  assert.equal(routeOverride(at("https://teitrand.github.io/ferjeruter-react/?rute=kombi")), "kombi");
  assert.equal(routeOverride(at("https://teitrand.github.io/ferjeruter-react/index.html?rute=1135")), "1135");
  assert.equal(routeOverride(at("https://teitrand.github.io/ferjeruter-react/?rute=tull")), null);
  assert.equal(routeOverride(at("https://ruter.trandal.org/?rute=kombi")), null);
  assert.equal(routeOverride(at("https://teitrand.github.io/ferjeruter-reactx/?rute=kombi")), null);
});

test("?rute= verkar berre på /dev/ og localhost", () => {
  assert.equal(
    isPreview({ hostname: "localhost", pathname: "/", href: "http://localhost:8080/?rute=kombi" }),
    true
  );
  assert.equal(
    routeOverride({
      hostname: "localhost",
      pathname: "/",
      href: "http://localhost:8080/?rute=kombi",
    }),
    "kombi"
  );
  assert.equal(
    routeOverride({
      hostname: "teitrand.github.io",
      pathname: "/fergeruter/dev/",
      href: "https://teitrand.github.io/fergeruter/dev/?rute=1135",
    }),
    "1135"
  );
  assert.equal(
    routeOverride({
      hostname: "teitrand.github.io",
      pathname: "/fergeruter/",
      href: "https://teitrand.github.io/fergeruter/?rute=kombi",
    }),
    null
  );
});

test("quayPlace normaliserer Lekneset", () => {
  assert.equal(quayPlace("Lekneset ferjekai"), "Leknes");
});

test("driftsmelding seier kva ferje som køyrer kombiruta", () => {
  assert.equal(vesselFromText("Ruta blir utført av MF Geiranger."), "Geiranger");
  assert.equal(vesselFromText("Ruta blir utført av M/F Kvernes"), "Kvernes");
  assert.equal(vesselFromText("M/F Geiranger og M/F Kvernes kan brukast."), null);
});

test("appen viser same Frå-tid som kombirute-tabellen for alle daggrupper", () => {
  useKombi();
  for (const [kind, iso] of Object.entries(KOMBI_DATES)) {
    assert.equal(dayType(iso), kind);
    const legs = legsForDate(iso);
    const got = new Set(legs.map((leg) => `${leg.from}|${clockMin(leg.departure)}`));
    assert.deepEqual([...got].sort(), [...jsonFromKeys(kind)].sort(), kind);
  }
});

test("høgtidsdag i kombirute brukar søndagstabellen", () => {
  useKombi();
  const holidays = [
    "2026-01-01",
    "2026-04-02",
    "2026-04-03",
    "2026-04-06",
    "2026-05-01",
    "2026-05-14",
    "2026-05-17",
    "2026-05-25",
    "2026-12-25",
    "2026-12-26",
    "2027-01-01",
    "2027-03-25",
    "2027-03-26",
    "2027-03-29",
    "2027-05-01",
    "2027-05-06",
    "2027-05-17",
    "2027-12-25",
    "2027-12-26",
  ];
  const sunday = [...jsonFromKeys("sunday")].sort();
  for (const iso of holidays) {
    assert.equal(dayType(iso), "sunday", iso);
    const got = legsForDate(iso).map((leg) => `${leg.from}|${clockMin(leg.departure)}`);
    assert.deepEqual([...got].sort(), sunday, iso);
  }
  assert.equal(dayType("2027-05-07"), "weekday");
  assert.equal(dayType("2026-08-29"), "saturday");
  assert.equal(dayType("2026-10-04"), "sunday");
});

test("val kan skjule ankomsttider utan å miste destinasjon", () => {
  useKombi();
  const legs = legsForDate(WEEKDAY);
  assert.equal(showArrivals(), true);
  const shown = buildEvents(legs, null);
  assert.ok(shown.every((event) => event.kind !== "arr"));
  assert.ok(shown.filter((event) => event.kind === "dep").every((event) => event.quays.length === 2));
  setTestState({ hideArrivals: true });
  assert.equal(showArrivals(), false);
  const hidden = buildEvents(legs, null);
  assert.ok(hidden.every((event) => event.kind !== "arr"));
  assert.ok(hidden.filter((event) => event.kind === "dep").every((event) => event.quays.length === 2));
});

test("valet om ankomsttider vert hugsa", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  assert.equal(readHideArrivals(storage), false);
  writeHideArrivals(true, storage);
  assert.equal(readHideArrivals(storage), true);
  writeHideArrivals(false, storage);
  assert.equal(readHideArrivals(storage), false);
});

test("valet om samband vert hugsa, men ikkje kombirute", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  assert.equal(readRouteChoice(storage), "1136");
  writeRouteChoice("1135", storage);
  assert.equal(readRouteChoice(storage), "1135");
  writeRouteChoice("1136", storage);
  assert.equal(readRouteChoice(storage), "1136");
  writeRouteChoice(null, storage);
  assert.equal(readRouteChoice(storage), "1136");
  writeRouteChoice("kombi", storage);
  assert.equal(readRouteChoice(storage), "1136");
});

test("valt 1135 viser Sæbø–Leknes sjølv ved normal 1136-drift", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: WEEKDAY,
    routeChoice: "1135",
    messages: { messages: [] },
  });
  assert.equal(operationalMode(), "1136");
  assert.equal(chosenRoute(), "1135");
  assert.equal(activeMode(), "1135");
  const legs = legsForDate(WEEKDAY);
  assert.ok(legs.length > 0);
  assert.ok(
    legs.every(
      (leg) =>
        (leg.from === "Sæbø" && leg.to === "Leknes") || (leg.from === "Leknes" && leg.to === "Sæbø")
    )
  );
  const ids = visibleConnectionLines(legs).map((line) => line.id);
  assert.ok(ids.includes("saebo-trandal"));
  assert.ok(ids.includes("saebo-standal"));
  assert.ok(ids.includes("saebo-skar"));
  assert.ok(!ids.includes("saebo"));
  assert.ok(!ids.includes("oye"));
  assert.ok(!ids.includes("solavagen"));
  assert.ok(!ids.includes("hundeidvika"));
});

test("valt 1136 viser kombiruta når kombiruta gjeld", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: WEEKDAY,
    routeChoice: "1136",
    messages: {
      messages: [{ isLocal: true, text: SMS, routeMode: "kombi", validTo: "2099-01-01T00:00:00Z" }],
    },
  });
  assert.equal(operationalMode(), "kombi");
  assert.equal(chosenRoute(), "1136");
  assert.equal(activeMode(), "kombi");
  const legs = legsForDate(WEEKDAY);
  assert.ok(legs.length > 0);
  assert.ok(legs.some((leg) => leg.to === "Leknes" || leg.from === "Leknes"));
});

test("valt 1135 viser kombiruta når kombiruta gjeld", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: WEEKDAY,
    routeChoice: "1135",
    messages: {
      messages: [{ isLocal: true, text: SMS, routeMode: "kombi", validTo: "2099-01-01T00:00:00Z" }],
    },
  });
  assert.equal(operationalMode(), "kombi");
  assert.equal(chosenRoute(), "1135");
  assert.equal(activeMode(), "kombi");
  const legs = legsForDate(WEEKDAY);
  assert.ok(legs.some((leg) => leg.from === "Sæbø" && leg.to === "Leknes"));
  assert.ok(legs.some((leg) => leg.from === "Standal" || leg.to === "Standal"));
});

test("sida har val for å byte fergestrekning", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../assets/app.js", import.meta.url), "utf8");
  assert.match(html, /id="route-filter"/);
  assert.match(html, /class="header-routes/);
  assert.match(html, /data-i18n="route.label"/);
  assert.match(html, /class="filters route-switch"/);
  assert.match(html, /id="route-badge"/);
  assert.match(html, /class="extras-row"/);
  assert.match(html, /data-filter="local"/);
  assert.match(html, /data-filter="route"/);
  assert.doesNotMatch(html, /data-filter="issues"/);
  assert.doesNotMatch(html, /Berre avvik/);
  assert.match(html, /class="site-header is-pending-route"/);
  assert.match(html, /fergeruter-last-mode/);
  assert.match(html, /class="visually-hidden"/);
  assert.match(app, /whenMessagesHydrated/);
  assert.match(app, /hydrateCachedMessages/);
  assert.match(app, /t\("messages.title"\)/);
  assert.match(app, /usefulMessageFilters/);
  assert.match(html, /id="day-today"[\s\S]*?id="day-prev"[\s\S]*?id="day-label"[\s\S]*?id="day-next"/);
  assert.doesNotMatch(html, /id="day-today"[^>]*\bhidden\b/);
  assert.match(app, /todayBtn\.disabled = isToday\(\)/);
  assert.match(app, /messages-count/);
  assert.match(app, /sortMessagesForRoute/);
  assert.doesNotMatch(html, /id="next-summary"/);
  assert.doesNotMatch(html, /Etter drift/);
  assert.doesNotMatch(html, /class="route-row"/);
  assert.doesNotMatch(html, /class="view-row"/);
  assert.doesNotMatch(html, /class="conn-row"/);
  assert.match(html, /id="trip-filter"/);
  assert.match(app, /t\("conn.none"\)/);
  assert.match(app, /t\("place.from"\)/);
  assert.match(app, /t\("place.to"\)/);
  assert.match(app, /t\("view.arrivals"\)/);
  assert.match(app, /messagesExpanded/);
});

test("rutetabellen kan hentast frå lokal cache utan nett", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  assert.equal(readCachedTimetable(storage), null);
  writeCachedTimetable({ routes: ruter, kombirute: kombi, connections: { fetchedAt: "2026-08-29" } }, storage);
  const cached = readCachedTimetable(storage);
  assert.equal(cached.routes.fetchedAt, ruter.fetchedAt);
  assert.equal(cached.kombirute.validFrom, kombi.validFrom);
  assert.equal(store.has(TIMETABLE_CACHE_KEY), true);
  assert.equal(
    timetableFingerprint(ruter, kombi, { fetchedAt: "2026-08-29" }),
    timetableFingerprint(cached.routes, cached.kombirute, cached.connections)
  );
  assert.notEqual(
    timetableFingerprint(ruter, kombi, { fetchedAt: "2026-08-29" }),
    timetableFingerprint({ ...ruter, fetchedAt: "2026-09-01T00:00:00Z" }, kombi, {
      fetchedAt: "2026-08-29",
    })
  );
});

test("melding-fingeravtrykk ignorerer fetchedAt, men ser innhald", () => {
  const a = {
    fetchedAt: "2026-09-03T08:00:00Z",
    messages: [{ id: "1", text: "innstilt", validTo: "x", severity: "cancelled", routeMode: "1135" }],
  };
  const b = { ...a, fetchedAt: "2026-09-03T08:05:00Z" };
  const c = {
    fetchedAt: a.fetchedAt,
    messages: [{ id: "1", text: "normal drift", validTo: "x", severity: "normal", routeMode: "1136" }],
  };
  assert.equal(messagesFingerprint(a), messagesFingerprint(b));
  assert.notEqual(messagesFingerprint(a), messagesFingerprint(c));
});

test("kombirute viser alle ankomstar frå overfartstid", () => {
  useKombi();
  assert.equal(kombi.crossingMinutes["Leknes–Trandal"], 20);
  assert.equal(kombi.crossingMinutes["Trandal–Leknes"], 20);
  for (const [kind, iso] of Object.entries(KOMBI_DATES)) {
    const legs = legsForDate(iso);
    const events = buildEvents(legs, null);
    const fromKeys = jsonFromKeys(kind);
    const deps = events
      .filter((event) => event.kind === "dep")
      .map((event) => `${event.quays[0]}|${event.at}`);
    assert.deepEqual([...new Set(deps)].sort(), [...fromKeys].sort(), kind);
    const expectedArr = new Set(legs.map((leg) => `${leg.to}|${clockMin(leg.arrival)}`));
    const dests = events
      .filter((event) => event.kind === "dep")
      .map((event) => `${event.leg.to}|${clockMin(event.leg.arrival)}`);
    assert.deepEqual([...new Set(dests)].sort(), [...expectedArr].sort(), kind);
    for (const leg of legs) {
      const key = `${leg.from}–${leg.to}`;
      const sailing = kombi.crossingMinutes[key];
      assert.equal(typeof sailing, "number", key);
      assert.equal(clockMin(leg.arrival), (clockMin(leg.departure) + sailing) % (24 * 60), key);
    }
  }
});

test("1136 merkar berre PDF-fotnote 1) og 3) som signal", () => {
  setTestState({ routes: ruter, kombirute: kombi, messages: { messages: [] } });
  const friday = legsForDate("2026-10-02");
  const standal0740 = friday.find((leg) => leg.from === "Standal" && leg.departure === "07:40:00");
  const saebo0835 = friday.find((leg) => leg.from === "Sæbø" && leg.departure === "08:35:00");
  const standal0645 = friday.find((leg) => leg.from === "Standal" && leg.departure === "06:45:00");
  assert.ok(standal0740);
  assert.equal(standal0740.signal, null);
  assert.ok(saebo0835?.signal);
  assert.equal(saebo0835.signal.minutesBefore, 60);
  assert.ok(standal0645?.signal);

  const saturday = legsForDate("2026-10-03");
  const satStandal = saturday.find((leg) => leg.from === "Standal" && leg.departure === "07:40:00");
  const satTrandal = saturday.find((leg) => leg.from === "Trandal" && leg.departure === "08:00:00");
  assert.equal(satStandal?.signal, null);
  assert.ok(satTrandal?.signal);

  const wednesday = legsForDate("2026-10-07");
  const valderoya = wednesday.find(
    (leg) => leg.from === "Valderøya" && leg.departure === "11:10:00"
  );
  assert.ok(valderoya?.signal);
  assert.equal(valderoya.signal.minutesBefore, 180);
});

test("1135 merkar matpause som liggetid, ikkje innkomst ved valt kai", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: "2026-10-04",
    routeChoice: "1135",
    messages: { messages: [] },
  });
  const legs = legsForDate("2026-10-04");
  const all = buildEvents(legs, null);
  assert.ok(all.every((event) => event.kind !== "arr"));
  const stays = all.filter((event) => event.kind === "layover");
  assert.ok(stays.length > 0);
  assert.ok(stays.every((event) => event.quays[0] === "Sæbø"));
  assert.ok(stays.every((event) => event.stay.minutes >= 20));
  const meal = stays.find((event) => event.at === 9 * 60 + 28);
  assert.equal(meal.stay.minutes, 62);
  setTestState({ fromFilter: "Leknes" });
  const leknes = buildEvents(legs, null);
  assert.ok(leknes.every((event) => event.kind !== "arr"));
  assert.ok(leknes.every((event) => event.kind !== "layover"));
  setTestState({ fromFilter: "Sæbø" });
  const saebo = buildEvents(legs, null);
  assert.ok(saebo.some((event) => event.kind === "layover" && event.stay.minutes === 62));
});

test("1135 har inga PDF-fotnote og inga signalmerke", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    messages: {
      messages: [
        {
          isLocal: true,
          text: "Rute 1136 Standal-Trandal er innstilt inntil vidare.",
          routeMode: "1135",
          validTo: "2099-01-01T00:00:00Z",
        },
      ],
    },
  });
  const legs = legsForDate(WEEKDAY);
  assert.ok(legs.length > 0);
  assert.ok(legs.every((leg) => !leg.signal));
});

test("kombirute merkar berre fotnote-celler som signal", () => {
  useKombi();
  for (const iso of Object.values(KOMBI_DATES)) {
    const legs = legsForDate(iso);
    assert.ok(legs.some((leg) => leg.signal));
    assert.ok(legs.some((leg) => !leg.signal));
    assert.ok(legs.filter((leg) => leg.signal).every((leg) => leg.requestStop));
    assert.equal(
      legs.filter((leg) => leg.from === "Sæbø" && leg.to === "Skår").length,
      0
    );
  }
});

test("signaltur ringjer rett ferje, tel:+47", () => {
  setTestState({ routes: ruter, kombirute: kombi, messages: { messages: [] } });
  const friday = legsForDate("2026-10-02");
  const saebo0835 = friday.find((leg) => leg.from === "Sæbø" && leg.departure === "08:35:00");
  assert.equal(telHref("91 66 93 40"), "tel:+4791669340");
  assert.equal(telHref("91669321"), "tel:+4791669321");
  assert.equal(telHref("+47 916 69 340"), "tel:+4791669340");
  assert.equal(telHref(signalPhone(saebo0835)), "tel:+4791669340");

  useKombi();
  const kombiLeg = legsForDate("2026-09-17").find((leg) => leg.signal);
  assert.ok(kombiLeg);
  assert.equal(telHref(signalPhone(kombiLeg)), "tel:+4791669340");

  const verksted = {
    isLocal: true,
    isRouteControl: true,
    heading: "Standal-Trandal",
    text: "På grunn av planlagt verkstedopphald blir det utført kombinert rute i sambandet frå måndag 14.09 til og med fredag 18.09. Det blir MF Geiranger i rute (91669321).",
    vessel: "Geiranger",
    routeMode: "kombi",
    routeWindow: { from: "2026-09-14", to: "2026-09-18" },
    publishedAt: "2026-09-11T10:45:19+02:00",
    validTo: "2099-01-01T00:00:00Z",
  };
  setTestState({
    date: "2026-09-17",
    messages: { messages: [verksted] },
  });
  const during = legsForDate("2026-09-17").find((leg) => leg.signal);
  assert.ok(during);
  assert.equal(vesselNameForTable("kombi"), "Geiranger");
  assert.equal(telHref(signalPhone(during)), "tel:+4791669321");

  setTestState({ date: "2026-10-03" });
  assert.equal(operationalMode("2026-10-03"), "1136");
  assert.equal(vesselNameForTable("1136"), "Kvernes");
  assert.equal(vesselNameForTable("kombi"), null);
  const after = legsForDate("2026-10-03").find((leg) => leg.signal);
  assert.ok(after);
  assert.equal(after.table, "1136");
  assert.equal(telHref(signalPhone(after)), "tel:+4791669340");
});

test("avlyste morgonsignalturar inne i fjorden er kai, ikkje tomtur", () => {
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: "2026-10-02",
    routeChoice: "1136",
    messages: { messages: [] },
  });
  const day = legsForDate("2026-10-02");
  const skipped = new Set(["08:35:00", "08:55:00", "09:20:00"]);
  const running = day.filter((leg) => !(leg.signal && skipped.has(leg.departure)));
  const during = ferryStatus(running, 8 * 60 + 40, day);
  assert.equal(during.underway, undefined);
  assert.match(during.text, /ligg til kai/);
  assert.doesNotMatch(during.text, /utan passasjerar/);
  const alongside = ferryStatus(running, 8 * 60 + 57, day);
  assert.equal(alongside.text, during.text);
  assert.equal(alongside.underway, undefined);
});

test("kombirute er éi samanhengande rute utan tomflytting", () => {
  useKombi();
  for (const iso of Object.values(KOMBI_DATES)) {
    const legs = legsForDate(iso);
    const events = buildEvents(legs, null);
    assert.ok(legs.some((leg) => leg.to === "Leknes"));
    assert.ok(
      legs.every((a, i) => !legs[i + 1] || a.to === legs[i + 1].from),
      "neste Frå-celle er neste anløp"
    );
    assert.ok(events.every((event) => event.kind !== "transfer"));
    assert.equal(events.filter((event) => event.kind === "split").length, 0);
    const mid = Math.floor(legs.length / 2);
    const status = ferryStatus(legs, clockMin(legs[mid].departure) - 10, legs);
    assert.doesNotMatch(status?.text || "", /utan passasjerar/);
    assert.doesNotMatch(status?.short || "", /utan passasjerar/);
  }
});

test("heildags kombirute får raud merking fyrste morgon, ikkje midt i perioden", () => {
  const verksted = {
    isLocal: true,
    isRouteControl: true,
    heading: "Leknes-Sæbø",
    text: "På grunn av planlagt verkstedopphald blir det utført kombinert rute i sambandet frå måndag 05.10 til og med fredag 09.10.",
    routeMode: "kombi",
    routeWindow: { from: "2026-10-05", to: "2026-10-09" },
    publishedAt: "2026-10-02T10:45:19+02:00",
    validTo: "2099-01-01T00:00:00Z",
  };
  setTestState({
    routes: ruter,
    kombirute: kombi,
    messages: { messages: [verksted] },
  });
  setTestState({ date: "2026-10-04" });
  assert.equal(operationalMode("2026-10-04"), "1136");
  assert.equal(buildEvents(legsForDate("2026-10-04"), null).filter((event) => event.kind === "split").length, 0);

  setTestState({ date: "2026-10-05" });
  assert.equal(operationalMode("2026-10-05"), "kombi");
  const monday = legsForDate("2026-10-05");
  const mondaySplits = buildEvents(monday, null).filter((event) => event.kind === "split");
  assert.equal(mondaySplits.length, 1);
  assert.equal(mondaySplits[0].at, clockMin(monday[0].departure));
  assert.equal(monday[0].departure, "06:00:00");

  setTestState({ date: "2026-10-06" });
  assert.equal(operationalMode("2026-10-06"), "kombi");
  assert.equal(buildEvents(legsForDate("2026-10-06"), null).filter((event) => event.kind === "split").length, 0);

  setTestState({ date: "2026-10-10" });
  assert.equal(operationalMode("2026-10-10"), "1136");
  const saturday = legsForDate("2026-10-10");
  const saturdaySplits = buildEvents(saturday, null).filter((event) => event.kind === "split");
  assert.equal(saturdaySplits.length, 1);
  assert.equal(saturdaySplits[0].at, clockMin(saturday[0].departure));

  setTestState({ date: "2026-10-10", routeChoice: "1135", toFilter: "Trandal" });
  assert.equal(activeMode(), "1135");
  const mixed = legsForPlaceFilter("2026-10-10", legsForDate("2026-10-10"));
  assert.ok(mixed.some((leg) => leg.table === "1135"));
  assert.ok(mixed.some((leg) => leg.table === "1136"));
  const filtered = buildEvents(mixed, null).filter((event) => matchesStop(event));
  assert.equal(
    filtered.filter((event) => event.kind === "split").length,
    0,
    "til-filter skal ikkje fylle laurdag med 1135/1136-skiftebanner"
  );
  assert.ok(filtered.some((event) => event.kind === "dep" && event.leg.to === "Trandal"));
});

test("tabellen merkar både start og slutt når ruta skifter to gonger", () => {
  const legs = [
    {
      from: "Standal",
      to: "Trandal",
      departure: "07:40:00",
      arrival: "07:55:00",
      table: "1136",
    },
    {
      from: "Sæbø",
      to: "Leknes",
      departure: "14:00:00",
      arrival: "14:13:00",
      table: "kombi",
    },
    {
      from: "Standal",
      to: "Trandal",
      departure: "18:30:00",
      arrival: "18:45:00",
      table: "1136",
    },
  ];
  const splits = buildEvents(legs, null).filter((event) => event.kind === "split");
  assert.equal(splits.length, 2);
  assert.equal(splits[0].at, 14 * 60);
  assert.equal(splits[1].at, 18 * 60 + 30);
});

const KVILE_HTML = `
<div class="view-type view-type-standard traffic-message">
  <div class="fjord1-alert fjord1-alert--warning">
    <h3 class="fjord1-alert__header"><span class="ezstring-field">Standal-Trandal-Valderøya-Store Kalvøy</span></h3>
    <div class="fjord1-alert__content">
      <span class="ezstring-field">Rute 1136 Standal-Trandal-Valderøya-Store Kalvøy: Grunna kviletidsbestemmelser og pålagt kvile til mannskapet vert følgjande avgangar innstilt: 20:00 og 20:40 frå Standal, 20:20 og 21:00 frå Trandal</span>
    </div>
    <div class="fjord1-alert__footer">
      13.09.2026, kl. 17:57
    </div>
  </div>
</div>`;

test("Fjord1-HTML med kvilemelding blir lokale innstilte avgangar, ikkje 1135", () => {
  const messages = parseFjord1TrafficHtml(KVILE_HTML);
  assert.equal(messages.length, 1);
  const msg = messages[0];
  assert.equal(msg.isLocal, true);
  assert.equal(msg.isRoute1136, true);
  assert.equal(msg.severity, "cancelled");
  assert.equal(msg.routeMode, "1136");
  assert.equal(msg.isRouteControl, false);
  assert.equal(isPartialCancel(msg.text), true);
  assert.deepEqual(
    cancelledSailingsFromText(msg.text).map((item) => `${item.from}|${item.time}`),
    ["Standal|20:00:00", "Standal|20:40:00", "Trandal|20:20:00", "Trandal|21:00:00"]
  );
  assert.equal(msg.publishedAt, "2026-09-13T15:57:00.000Z");
});

test("Fjord1-node blir normalisert likt Python-skriptet", () => {
  const msg = normalizeFjord1Node({
    id: "1",
    heading: "Standal-Trandal-Valderøya-Store Kalvøy",
    countyNumber: 15,
    connectionNumber: 132,
    date: "24.08.2026 12:46:06",
    content: "Rute 1136: normal drift.",
    importantMessage: false,
    validFrom: { timestamp: 1787568366 },
    validTo: { timestamp: 1787654704 },
  });
  assert.equal(msg.severity, "normal");
  assert.equal(msg.isRoute1136, true);
  assert.equal(msg.isLocal, true);
  assert.equal(msg.routeMode, "1136");
  assert.equal(msg.activateAt, null);
  assert.equal(classifyMessage("må påregnes forsinkelser"), "delay");
  assert.equal(parseFjord1Published("13.09.2026, kl. 17:57"), "2026-09-13T15:57:00.000Z");
});

test("live Fjord1-meldingar blir fletta inn i gammal GitHub-kopi", () => {
  const stale = {
    source: "https://www.fjord1.no/trafikkmeldingar",
    fetchedAt: "2026-09-13T13:54:00.000Z",
    messages: [
      {
        id: "old",
        heading: "Drag - Kjøpsvik",
        text: "Rute 201108: normal drift.",
        publishedAt: "2026-08-30T07:56:37+02:00",
        isLocal: false,
      },
    ],
  };
  assert.equal(messagesAreStale(stale, Date.parse("2026-09-13T16:00:00Z")), true);
  assert.equal(
    messagesAreStale(
      { fetchedAt: "2026-09-13T15:55:00.000Z" },
      Date.parse("2026-09-13T16:00:00Z")
    ),
    false
  );
  assert.ok(MESSAGES_STALE_MS > 5 * 60 * 1000);
  const live = {
    source: "https://www.fjord1.no/trafikkmeldingar",
    fetchedAt: "2026-09-13T16:01:00.000Z",
    fetchedLive: true,
    messages: parseFjord1TrafficHtml(KVILE_HTML),
  };
  const merged = mergeMessagePayloads(stale, live);
  assert.equal(merged.fetchedLive, true);
  assert.equal(merged.messages.length, 2);
  assert.ok(merged.messages.some((msg) => msg.text.includes("kviletidsbestemmelser")));
  setTestState({
    routes: ruter,
    kombirute: kombi,
    date: "2026-09-13",
    routeChoice: "1136",
    messages: merged,
  });
  assert.equal(routeModeFromMessages(merged.messages, Date.parse("2026-09-13T16:10:00Z"), "2026-09-13"), "1136");
  assert.equal(isCancelledDeparture({ from: "Standal", departure: "20:00:00" }), true);
  assert.equal(isCancelledDeparture({ from: "Standal", departure: "19:20:00" }), false);
});

const KOMBI_1136 = {
  id: "msg-1136",
  heading: "Standal-Trandal-Valderøya-Store Kalvøy",
  text: "Rute 1136 Standal-Trandal: På grunn av planlagt verkstedopphald blir det utført kombinert rute frå måndag 14.09 til og med fredag 18.09.",
  isLocal: true,
  isRoute1136: true,
  isRouteControl: true,
  routeMode: "kombi",
  connectionNumber: 132,
  severity: "info",
  validTo: "2099-01-01T00:00:00Z",
};
const KOMBI_1135 = {
  id: "msg-1135",
  heading: "Leknes-Sæbø",
  text: "Rute 1135 Lekneset - Sæbø: På grunn av planlagt verkstedopphald blir det utført kombinert rute frå måndag 14.09 til og med fredag 18.09.",
  isLocal: true,
  isRoute1136: true,
  isRouteControl: true,
  routeMode: "kombi",
  connectionNumber: 134,
  severity: "info",
  validTo: "2099-01-01T00:00:00Z",
};

test("sambandsfilter skil 1135 og 1136", () => {
  setTestState({ routeChoice: "1136", messageFilter: "local" });
  assert.equal(matchesChosenRouteNotice(KOMBI_1136, "1136"), true);
  assert.equal(matchesChosenRouteNotice(KOMBI_1135, "1136"), false);
  assert.equal(matchesChosenRouteNotice(KOMBI_1135, "1135"), true);
  assert.equal(matchesChosenRouteNotice(KOMBI_1136, "1135"), false);

  const all = [KOMBI_1136, KOMBI_1135];
  setTestState({ routeChoice: "1136", messageFilter: "route" });
  assert.deepEqual(
    applyMessageFilter(all).map((msg) => msg.id),
    ["msg-1136"]
  );
  setTestState({ routeChoice: "1135", messageFilter: "route" });
  assert.deepEqual(
    applyMessageFilter(all).map((msg) => msg.id),
    ["msg-1135"]
  );
  assert.deepEqual(usefulMessageFilters(all, "1136"), ["local", "route"]);
  assert.deepEqual(usefulMessageFilters([KOMBI_1136], "1136"), []);
});

test("lagra meldingar gjev kombirute med ein gong, utan å vente på nett", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  const payload = { fetchedAt: "2026-09-16T06:00:00Z", messages: [KOMBI_1136, KOMBI_1135] };
  writeCachedMessages(payload, storage);
  assert.equal(store.has(MESSAGES_CACHE_KEY), true);
  assert.equal(readCachedMessages(storage).messages[0].id, "msg-1136");
  hydrateCachedMessages(storage);
  setTestState({ date: "2026-09-16" });
  assert.equal(operationalMode("2026-09-16"), "kombi");
  writeLastMode("kombi", "2026-09-16", storage);
  assert.deepEqual(readLastMode(storage), { date: "2026-09-16", mode: "kombi" });
});

