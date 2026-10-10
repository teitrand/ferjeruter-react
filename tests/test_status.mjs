import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";
import {
  buildEvents,
  emptyPlaceMessage,
  ferryStatus,
  keepTimelineEvent,
  liveBlockedUntil,
  liveFetchUrls,
  liveStatus,
  loadLivePosition,
  positionNoteKey,
  currentStatus,
  signalVerdict,
  signalSailed,
  rememberLiveSailed,
  readSailedJourneys,
  writeSailedJourneys,
  signalObservedAtQuay,
  signalIsBooked,
  departureDetail,
  signalLogStatus,
  signalLogStale,
  matchesLegPlaces,
  matchesStop,
  messageRouteScore,
  sortMessagesForRoute,
  swapPlaceFilters,
  noteLiveFailure,
  parseVehicleMonitoring,
  pastDepartureCount,
  resetTestState,
  setTestState,
  shouldFetchLive,
  serviceWindowMinutes,
} from "../assets/app.js";
import {
  compareTimelineEvents,
  delayMinutes,
  statusProgress,
  homeQuay,
  isLiveFresh,
  layoverAfter,
  liveProvesSailed,
  cancelledJourneyIds,
  actualDeparturesFromPayload,
  osloDayStartIso,
  OUTER_DEADHEAD_MINUTES,
  headingDay,
  todayIso,
  quayPlace,
} from "../packages/core/index.js";
import { appVersion } from "./helpers/version.mjs";
// Arbeidsflyta listar testfilene ein og ein. Desse køyrer difor herifrå.
import "./test_tripstatus.mjs";
import "./test_replay_tripstatus.mjs";
import "./test_web.mjs";

const { setLang, t } = await import(`../assets/i18n.js?v=${appVersion()}`);

beforeEach(() => {
  setLang("nn");
  resetTestState();
});

function leg(from, to, departure, arrival, dates = ["2026-08-26"]) {
  return { from, to, departure, arrival, activeDates: dates };
}

const wednesday = [
  leg("Standal", "Trandal", "07:40:00", "07:55:00"),
  leg("Trandal", "Sæbø", "08:00:00", "08:30:00"),
  leg("Sæbø", "Trandal", "08:35:00", "08:55:00"),
  leg("Valderøya", "Store Kalvøy", "11:10:00", "11:30:00"),
  leg("Store Kalvøy", "Valderøya", "12:10:00", "12:30:00"),
  leg("Standal", "Trandal", "14:40:00", "14:55:00"),
  leg("Trandal", "Sæbø", "15:00:00", "15:25:00"),
  leg("Sæbø", "Trandal", "15:25:00", "15:45:00"),
  leg("Trandal", "Standal", "15:50:00", "16:05:00"),
  leg("Standal", "Trandal", "16:10:00", "16:25:00"),
  leg("Trandal", "Standal", "16:30:00", "16:45:00"),
  leg("Valderøya", "Store Kalvøy", "19:00:00", "19:20:00"),
  leg("Store Kalvøy", "Valderøya", "19:25:00", "19:45:00"),
];

const weekdayHome = [
  leg("Standal", "Trandal", "06:45:00", "07:00:00", ["2026-08-25"]),
  leg("Trandal", "Standal", "20:20:00", "20:35:00", ["2026-08-25"]),
];

test("heimkaia er fyrste avgang", () => {
  assert.equal(homeQuay(wednesday), "Standal");
});

test("før fyrste avgang ligg ferja på Standal", () => {
  const status = ferryStatus(wednesday, 7 * 60 + 10, wednesday);
  assert.equal(status.short, "Ferja ligg til kai på Standal");
  assert.equal(status.underway, undefined);
});

test("på veg i ein passasjertur", () => {
  const status = ferryStatus(wednesday, 7 * 60 + 45, wednesday);
  assert.equal(status.text, "Ferja er på veg mot Trandal");
  assert.equal(status.underway, true);
  assert.equal(status.from, 7 * 60 + 40);
  assert.equal(status.until, 7 * 60 + 55);
  assert.equal(status.progress, 5 / 15);
});

test("NO-status fyller tida mellom stopp, òg i liggetid og kort kai-opphald", () => {
  assert.equal(statusProgress(10, 20, 15), 0.5);
  assert.equal(statusProgress(10, 20, 8), 0);
  assert.equal(statusProgress(10, 20, 30), 1);
  assert.equal(statusProgress(10, 10, 10), null);
  const wait = ferryStatus(wednesday, 7 * 60 + 57, wednesday);
  assert.equal(wait.underway, undefined);
  assert.equal(wait.progress, 2 / 5);
  const stay = ferryStatus(wednesday, 11 * 60 + 50, wednesday);
  assert.equal(stay.layover, true);
  assert.equal(stay.progress, 0.5);
  const before = ferryStatus(wednesday, 7 * 60 + 10, wednesday);
  assert.equal(before.progress, undefined);
  const done = ferryStatus(weekdayHome, 21 * 60, weekdayHome);
  assert.equal(done.progress, undefined);
});

test("hol inne i fjorden er kai, ikkje tomtur", () => {
  const running = [
    leg("Trandal", "Sæbø", "08:00:00", "08:30:00"),
    leg("Trandal", "Standal", "09:45:00", "10:00:00"),
  ];
  const catalog = [...running, leg("Sæbø", "Trandal", "09:20:00", "09:45:00")];
  const during = ferryStatus(running, 8 * 60 + 40, catalog);
  assert.equal(during.underway, undefined);
  assert.equal(during.text, "Ferja ligg til kai på Sæbø");
  assert.equal(during.from, 8 * 60 + 30);
  assert.equal(during.until, 9 * 60 + 45);
  const later = ferryStatus(running, 8 * 60 + 57, catalog);
  assert.equal(later.text, "Ferja ligg til kai på Sæbø");
  assert.doesNotMatch(during.text, /utan passasjerar/);
});

test("hol utan kjend overfart inne i fjorden er òg kai", () => {
  const legs = [
    leg("Sæbø", "Skår", "08:35:00", "08:55:00"),
    leg("Trandal", "Standal", "09:45:00", "10:00:00"),
  ];
  const status = ferryStatus(legs, 9 * 60, legs);
  assert.equal(status.underway, undefined);
  assert.equal(status.text, "Ferja ligg til kai på Skår");
  assert.equal(status.until, 9 * 60 + 45);
  assert.doesNotMatch(status.text, /utan passasjerar/);
});

test("etter siste passasjertur til Valderøya går ho heim utan folk", () => {
  const status = ferryStatus(wednesday, 19 * 60 + 50, wednesday);
  assert.match(status.short, /tilbake til Standal/);
  assert.match(status.text, /Valderøya/);
  assert.equal(status.underway, true);
  assert.equal(status.until, 19 * 60 + 45 + OUTER_DEADHEAD_MINUTES);
  assert.doesNotMatch(status.text, /ferdig for dagen på Valderøya/);
});

test("etter tomturen heim ligg ho på Standal", () => {
  const still = ferryStatus(wednesday, 21 * 60 + 30, wednesday);
  assert.equal(still.underway, true);
  const status = ferryStatus(wednesday, 21 * 60 + 50, wednesday);
  assert.equal(status.short, "Ferja ligg til kai på Standal");
  assert.match(status.text, /Standal/);
  assert.doesNotMatch(status.text, /Valderøya/);
  assert.equal(OUTER_DEADHEAD_MINUTES, 120);
});

test("dagar der siste anløp er Standal seier ferdig der", () => {
  const status = ferryStatus(weekdayHome, 21 * 60, weekdayHome);
  assert.equal(status.short, "Ferja er ferdig for dagen på Standal");
  assert.equal(status.text, "Ferja er ferdig for dagen på Standal.");
});

test("nattur frå Valderøya har fast tid òg utan hol i tabellen", () => {
  const onlyEvening = [
    leg("Standal", "Trandal", "07:40:00", "07:55:00"),
    leg("Store Kalvøy", "Valderøya", "19:25:00", "19:45:00"),
  ];
  const during = ferryStatus(onlyEvening, 20 * 60, onlyEvening);
  assert.equal(during.underway, true);
  assert.match(during.short, /tilbake til Standal/);
  assert.equal(during.until, 19 * 60 + 45 + OUTER_DEADHEAD_MINUTES);
  assert.doesNotMatch(during.text, /over natta/);
  const home = ferryStatus(onlyEvening, 21 * 60 + 50, onlyEvening);
  assert.equal(home.short, "Ferja ligg til kai på Standal");
});

test("siste anløp inne i fjorden er ikkje tomtur heim", () => {
  const onlyEvening = [
    leg("Standal", "Trandal", "07:40:00", "07:55:00"),
    leg("Trandal", "Bjørke", "19:25:00", "19:45:00"),
  ];
  const status = ferryStatus(onlyEvening, 20 * 60, onlyEvening);
  assert.equal(status.short, "Ferja er ferdig for dagen på Bjørke");
  assert.equal(status.underway, undefined);
  assert.doesNotMatch(status.text, /utan passasjerar/);
});

test("tomtur Valderøya til Standal varer den faste tida, deretter kai", () => {
  const during = ferryStatus(wednesday, 13 * 60, wednesday);
  assert.equal(during.underway, true);
  assert.equal(during.text, "Ferja går til Standal utan passasjerar");
  assert.equal(during.from, 12 * 60 + 30);
  assert.equal(during.until, 12 * 60 + 30 + OUTER_DEADHEAD_MINUTES);
  const alongside = ferryStatus(wednesday, 14 * 60 + 35, wednesday);
  assert.equal(alongside.underway, undefined);
  assert.equal(alongside.text, "Ferja ligg til kai på Standal");
  assert.equal(alongside.from, 14 * 60 + 30);
  assert.equal(alongside.until, 14 * 60 + 40);
});

test("tomtur ut til Valderøya varer den faste tida, deretter kai før avgang", () => {
  const during = ferryStatus(wednesday, 9 * 60 + 30, wednesday);
  assert.equal(during.underway, true);
  assert.equal(during.text, "Ferja går til Valderøya utan passasjerar");
  assert.equal(during.from, 8 * 60 + 55);
  assert.equal(during.until, 8 * 60 + 55 + OUTER_DEADHEAD_MINUTES);
  const alongside = ferryStatus(wednesday, 11 * 60, wednesday);
  assert.equal(alongside.text, "Ferja ligg til kai på Valderøya");
  assert.equal(alongside.from, 10 * 60 + 55);
  assert.equal(alongside.until, 11 * 60 + 10);
});

test("laurdagsholet til Standal er på veg i den faste tida", () => {
  const legs = [
    leg("Store Kalvøy", "Valderøya", "13:15:00", "13:35:00"),
    leg("Standal", "Trandal", "16:05:00", "16:20:00"),
  ];
  const during = ferryStatus(legs, 14 * 60, legs);
  assert.equal(during.text, "Ferja går til Standal utan passasjerar");
  assert.equal(during.until, 13 * 60 + 35 + OUTER_DEADHEAD_MINUTES);
  const alongside = ferryStatus(legs, 15 * 60 + 40, legs);
  assert.equal(alongside.text, "Ferja ligg til kai på Standal");
  assert.equal(alongside.until, 16 * 60 + 5);
});

test("kortare hol enn tomturen varer heile holet", () => {
  const legs = [
    leg("Store Kalvøy", "Valderøya", "11:10:00", "11:30:00"),
    leg("Standal", "Trandal", "12:20:00", "12:35:00"),
  ];
  const status = ferryStatus(legs, 12 * 60, legs);
  assert.equal(status.underway, true);
  assert.equal(status.until, 12 * 60 + 20);
});

test("quayPlace strippar ferjekai", () => {
  assert.equal(quayPlace("Valderøya ferjekai"), "Valderøya");
  assert.equal(quayPlace("Standal"), "Standal");
  assert.equal(quayPlace("Lekneset ferjekai"), "Leknes");
});

test("delayMinutes les ISO-varigheit og sekund", () => {
  assert.equal(delayMinutes("PT2M"), 2);
  assert.equal(delayMinutes("PT1H5M"), 65);
  assert.equal(delayMinutes(120), 2);
  assert.equal(delayMinutes("PT0S"), 0);
});

test("parseVehicleMonitoring tom levering", () => {
  assert.equal(
    parseVehicleMonitoring({
      Siri: { ServiceDelivery: { VehicleMonitoringDelivery: [{ version: "2.0" }] } },
    }),
    null
  );
});

test("parseVehicleMonitoring les destinasjon og posisjon", () => {
  const live = parseVehicleMonitoring({
    Siri: {
      ServiceDelivery: {
        VehicleMonitoringDelivery: [
          {
            VehicleActivity: {
              ValidUntilTime: "2026-08-26T23:10:00+02:00",
              RecordedAtTime: "2026-08-26T23:08:00+02:00",
              MonitoredVehicleJourney: {
                DestinationName: [{ value: "Standal ferjekai" }],
                Delay: "PT3M",
                VehicleLocation: { Latitude: 62.3, Longitude: 6.4 },
              },
            },
          },
        ],
      },
    },
  });
  assert.equal(live.destination, "Standal");
  assert.equal(live.delayMinutes, 3);
  assert.equal(live.latitude, 62.3);
});

test("parseVehicleMonitoring kuttar destinasjonslista til neste kai", () => {
  const live = parseVehicleMonitoring({
    Siri: {
      ServiceDelivery: {
        VehicleMonitoringDelivery: [
          {
            VehicleActivity: {
              ValidUntilTime: "2099-01-01T00:00:00Z",
              MonitoredVehicleJourney: {
                DestinationName: [{ value: "Sæbø Trandal Standal" }],
                Delay: "PT1M",
                VehicleLocation: { Latitude: 62.2, Longitude: 6.5 },
              },
            },
          },
        ],
      },
    },
  });
  assert.equal(live.destination, "Sæbø");
  assert.equal(live.delayMinutes, 1);
});

test("parseVehicleMonitoring vel den nyaste aktiviteten, ikkje den første", () => {
  // Entur 2026-10-07 11:12: gammal 08:00-tur fyrst, fersk tur mot Valderøya etterpå.
  const live = parseVehicleMonitoring({
    Siri: {
      ServiceDelivery: {
        VehicleMonitoringDelivery: [
          {
            VehicleActivity: [
              {
                RecordedAtTime: "2026-10-07T11:05:12+02:00",
                ValidUntilTime: "2026-10-07T11:07:12+02:00",
                MonitoredVehicleJourney: {
                  DestinationName: [{ value: "Sæbø Skår" }],
                  FramedVehicleJourneyRef: {
                    DatedVehicleJourneyRef: "MOR:ServiceJourney:1136_106_9150000047472932",
                  },
                  VehicleLocation: { Latitude: 62.494873, Longitude: 6.133823 },
                },
              },
              {
                RecordedAtTime: "2026-10-07T11:12:35+02:00",
                ValidUntilTime: "2026-10-07T11:14:35+02:00",
                MonitoredVehicleJourney: {
                  DestinationName: [{ value: "Valderøya" }],
                  FramedVehicleJourneyRef: {
                    DatedVehicleJourneyRef: "MOR:ServiceJourney:1136_110_9150000037358072",
                  },
                  VehicleLocation: { Latitude: 62.505405, Longitude: 6.175024 },
                },
              },
            ],
          },
        ],
      },
    },
  });
  assert.equal(live.destination, "Valderøya");
  assert.equal(live.validUntil, "2026-10-07T11:14:35+02:00");
  assert.equal(live.latitude, 62.505405);
});

const signalJourney = "MOR:ServiceJourney:1136_102_9150000047474169";

function signalLeg(from, to, departure, arrival, id = signalJourney) {
  return {
    id: `${id}#0`,
    from,
    to,
    departure,
    arrival,
    signal: { minutesBefore: 60, phone: "91 66 93 40" },
  };
}

function freshLive(partial) {
  return {
    validUntil: "2099-01-01T00:00:00Z",
    destination: "Trandal",
    delayMinutes: 40,
    latitude: 62.26652,
    longitude: 6.42321,
    atStop: true,
    stopName: "Standal",
    actualDeparture: "",
    originAimed: "2026-10-01T06:45:00+02:00",
    journeyRef: signalJourney,
    ...partial,
  };
}

const signalMorning = [
  signalLeg("Standal", "Trandal", "06:45:00", "07:00:00"),
  signalLeg("Trandal", "Standal", "07:05:00", "07:20:00", "MOR:ServiceJourney:1136_103_return"),
  leg("Standal", "Trandal", "07:40:00", "07:55:00"),
];

test("signaltur som ligg til kai etter avgang går ikkje", () => {
  const live = freshLive();
  const now = 7 * 60 + 25;
  assert.equal(signalVerdict(signalMorning[0], live, now, signalMorning), "skipped");
  assert.equal(signalVerdict(signalMorning[1], live, now, signalMorning), "skipped");
  // Før avgang veit vi ikkje: nokon kan ha ringt og bestilt.
  assert.equal(signalVerdict(signalMorning[0], live, 6 * 60 + 30, signalMorning), null);
  setTestState({ live });
  const status = currentStatus(signalMorning, now);
  assert.equal(status.signal, "skipped");
  assert.equal(status.short, "Signalturen frå Standal er ikkje utført");
  assert.match(status.text, /kl\. 06:45/);
  assert.match(status.text, /Standal/);
  assert.doesNotMatch(status.text, /forsinka/);
});

test("signaltur som er framme ved kai seier liggetid, ikkje på veg", () => {
  const backId = "MOR:ServiceJourney:1136_101_9150000046366323";
  const legs = [
    signalLeg("Standal", "Trandal", "06:45:00", "07:00:00"),
    signalLeg("Trandal", "Standal", "07:05:00", "07:20:00", backId),
    leg("Standal", "Trandal", "07:40:00", "07:55:00"),
  ];
  const live = freshLive({
    journeyRef: backId,
    originAimed: "2026-10-05T07:05:00+02:00",
    destination: "Standal",
    atStop: true,
    stopName: "Standal ferjekai",
    actualDeparture: "",
    actualArrival: "2026-10-05T07:21:34+02:00",
    latitude: 62.26652,
    longitude: 6.42321,
    delayMinutes: 1,
    recordedAt: "2026-10-05T07:21:34+02:00",
  });
  const now = 7 * 60 + 21;
  setTestState({ live });
  const status = currentStatus(legs, now);
  assert.equal(status.underway, undefined);
  assert.match(status.short, /ligg til kai på Standal/);
  assert.match(status.text, /ligg til kai på Standal/);
  assert.match(status.text, /07:40/);
  assert.match(status.text, /Liggetid/);
  assert.doesNotMatch(status.text, /på veg/);
  assert.doesNotMatch(status.text, /forsinka/);
});

test("planlagd ankomst som er passert er kai, forseinka ankomst er enno på veg", () => {
  const backId = "MOR:ServiceJourney:1136_101_9150000046366323";
  const legs = [
    signalLeg("Trandal", "Standal", "07:05:00", "07:20:00", backId),
    leg("Standal", "Trandal", "07:40:00", "07:55:00"),
  ];
  setTestState({
    live: freshLive({
      journeyRef: backId,
      originAimed: "2026-10-05T07:05:00+02:00",
      destination: "Standal",
      atStop: false,
      stopName: "",
      actualDeparture: "2026-10-05T07:06:00+02:00",
      delayMinutes: 0,
    }),
  });
  const arrived = currentStatus(legs, 7 * 60 + 22);
  assert.match(arrived.text, /ligg til kai på Standal/);
  assert.match(arrived.text, /07:40/);
  assert.doesNotMatch(arrived.text, /på veg/);
  setTestState({
    live: freshLive({
      journeyRef: backId,
      originAimed: "2026-10-05T07:05:00+02:00",
      destination: "Standal",
      atStop: false,
      stopName: "Trandal",
      actualDeparture: "2026-10-05T07:06:00+02:00",
      expectedArrival: "2026-10-05T07:30:00+02:00",
      delayMinutes: 10,
    }),
  });
  const late = currentStatus(legs, 7 * 60 + 22);
  assert.equal(late.underway, true);
  assert.match(late.text, /på veg mot Standal/);
  setTestState({
    live: freshLive({
      journeyRef: backId,
      originAimed: "2026-10-05T07:05:00+02:00",
      destination: "Standal",
      atStop: false,
      stopName: "Standal",
      actualDeparture: "2026-10-05T07:06:00+02:00",
      expectedArrival: "2026-10-05T07:30:00+02:00",
      delayMinutes: 10,
    }),
  });
  const expectedLater = currentStatus(legs, 7 * 60 + 22);
  assert.equal(expectedLater.underway, true);
  assert.match(expectedLater.text, /på veg mot Standal/);
  setTestState({
    live: freshLive({
      journeyRef: backId,
      originAimed: "2026-10-05T07:05:00+02:00",
      destination: "Standal",
      atStop: false,
      stopName: "Standal",
      actualDeparture: "2026-10-05T07:06:00+02:00",
      expectedArrival: "2026-10-05T07:21:00+02:00",
      delayMinutes: 1,
    }),
  });
  const expectedPassed = currentStatus(legs, 7 * 60 + 22);
  assert.match(expectedPassed.text, /ligg til kai på Standal/);
  assert.doesNotMatch(expectedPassed.text, /på veg/);
});

test("signaltur som har lagt frå kai blir køyrd, med forseinking", () => {
  const live = freshLive({
    atStop: false,
    stopName: "Trandal",
    actualDeparture: "2026-10-01T06:53:00+02:00",
    latitude: 62.263,
    longitude: 6.46,
    delayMinutes: 8,
  });
  const now = 6 * 60 + 55;
  assert.equal(signalVerdict(signalMorning[0], live, now, signalMorning), "running");
  // Returen kan vere bestilt på telefon, så før avgang seier vi ingenting.
  assert.equal(signalVerdict(signalMorning[1], live, now, signalMorning), null);
  setTestState({ live });
  const status = currentStatus(signalMorning, now);
  assert.equal(status.signal, "running");
  assert.equal(status.underway, true);
  assert.match(status.text, /på veg mot Trandal/);
  assert.match(status.text, /8 min forsinka/);
});

test("seinare kjøyretur markerer signalturen som ikkje køyrd", () => {
  const live = freshLive({
    journeyRef: "MOR:ServiceJourney:1136_104_regular",
    originAimed: "2026-10-01T07:40:00+02:00",
    atStop: false,
    stopName: "Trandal",
    latitude: 62.263,
    longitude: 6.46,
    delayMinutes: 0,
  });
  const legs = [
    ...signalMorning.slice(0, 2),
    {
      id: "MOR:ServiceJourney:1136_104_regular#0",
      from: "Standal",
      to: "Trandal",
      departure: "07:40:00",
      arrival: "07:55:00",
    },
  ];
  // Ferja kan ha køyrt 06:45 og 07:05 og så 07:40. Sanntid på 07:40 beviser ikkje noko om dei.
  assert.equal(signalVerdict(legs[0], live, 8 * 60, legs), null);
  assert.equal(signalVerdict(legs[1], live, 8 * 60, legs), null);
  // Utan returtur kunne ferja ikkje vore på Standal 07:40 om ho gjekk 06:45 til Trandal.
  const oneWay = [legs[0], legs[2]];
  assert.equal(signalVerdict(oneWay[0], live, 8 * 60, oneWay), "skipped");
  const detailLegs = oneWay.map((item) => ({ ...item, activeDates: [todayIso()] }));
  setTestState({ live, routes: { lines: { 1136: { legs: detailLegs } } } });
  const detail = departureDetail(detailLegs[0], 8 * 60);
  assert.equal(detail.phase, "skipped");
  assert.equal(detail.skipReason, "live");
  assert.equal(detail.seenSkip, false);
});

test("vanleg tur tek framleis med Entur-forseinking", () => {
  const legs = [
    {
      id: "MOR:ServiceJourney:normal#0",
      ...leg("Standal", "Trandal", "07:40:00", "07:55:00"),
    },
  ];
  setTestState({
    live: freshLive({
      journeyRef: "MOR:ServiceJourney:normal",
      originAimed: "2026-10-01T07:40:00+02:00",
      atStop: false,
      stopName: "",
      latitude: 62.263,
      longitude: 6.46,
      delayMinutes: 5,
    }),
  });
  const status = currentStatus(legs, 7 * 60 + 45);
  assert.match(status.text, /på veg mot Trandal/);
  assert.match(status.text, /5 min forsinka/);
});

test("logga tomtur som gjekk er ikkje ikkje utført og ikkje bestilt", () => {
  const id = "MOR:ServiceJourney:1136_102_9150000047474169";
  const trip = signalLeg("Standal", "Trandal", "06:45:00", "07:00:00", id);
  const yesterday = "2026-10-04";
  setTestState({
    date: yesterday,
    signalLog: {
      days: {
        [yesterday]: [
          {
            id,
            from: "Standal",
            to: "Trandal",
            departure: "06:45:00",
            status: "gått",
            observedAt: `${yesterday}T06:46:00+02:00`,
          },
        ],
      },
    },
  });
  assert.equal(signalLogStatus(trip), "gått");
  assert.equal(signalVerdict(trip, null, 12 * 60, [trip]), null);
  assert.equal(signalIsBooked(trip, 12 * 60), false);
  const detail = departureDetail(trip, 12 * 60);
  assert.equal(detail.phase, "sailed");
  assert.equal(detail.skipped, false);
  assert.equal(detail.booked, false);
  setTestState({ date: null });
  setTestState({
    signalLog: {
      days: {
        [todayIso()]: [
          {
            id,
            from: "Standal",
            to: "Trandal",
            departure: "06:45:00",
            status: "gått",
            observedAt: `${todayIso()}T06:46:00+02:00`,
          },
        ],
      },
    },
  });
  assert.notEqual(signalVerdict(trip, null, 12 * 60, [trip]), "skipped");
  assert.equal(signalIsBooked(trip, 12 * 60), false);
  assert.equal(departureDetail(trip, 12 * 60).phase, "sailed");
});

test("loggen viser bestilt og ikkje utført ei veke attende", () => {
  const booked = signalLeg("Standal", "Trandal", "13:00:00", "13:15:00", "MOR:ServiceJourney:1136_booked");
  const skipped = signalLeg(
    "Trandal",
    "Standal",
    "13:20:00",
    "13:35:00",
    "MOR:ServiceJourney:1136_skip"
  );
  setTestState({
    date: "2026-09-28",
    signalLog: {
      keptDays: 7,
      days: {
        "2026-09-28": [
          {
            id: "MOR:ServiceJourney:1136_booked",
            from: "Standal",
            to: "Trandal",
            departure: "13:00:00",
            status: "booked",
            evidence: "departed",
            observedAt: "2026-09-28T13:01:00+02:00",
          },
          { id: "MOR:ServiceJourney:1136_skip", from: "Trandal", to: "Standal", departure: "13:20:00", status: "skipped" },
        ],
      },
    },
  });
  assert.equal(signalLogStatus(booked), "booked");
  assert.equal(signalIsBooked(booked), true);
  assert.equal(signalVerdict(skipped), "skipped");
  assert.equal(signalIsBooked(skipped), false);
  const bare = signalLeg("Sæbø", "Skår", "16:50:00", "17:05:00", "MOR:ServiceJourney:1136_122");
  setTestState({
    date: "2026-09-28",
    cancelledJourneys: new Set(["MOR:ServiceJourney:1136_122"]),
    signalLog: {
      days: {
        "2026-09-28": [
          {
            id: "MOR:ServiceJourney:1136_122",
            from: "Sæbø",
            to: "Skår",
            departure: "16:50:00",
            status: "booked",
          },
        ],
      },
    },
  });
  // Dagsens avlysingar gjeld ikkje ein annan dag, og «booked» utan avgangsbevis er ikkje bevis
  // nokon veg. Utan bevis seier vi ikkje «ikkje utført».
  const detail = departureDetail(bare, 18 * 60);
  assert.equal(detail.booked, false);
  assert.equal(detail.skipped, false);
  assert.equal(detail.phase, "unknown");
});

test("logga ikkje utført blir ståande når Entur har gløymt avlysinga", () => {
  const id = "MOR:ServiceJourney:1136_128_9150000047474268";
  const trip = signalLeg("Standal", "Trandal", "20:00:00", "20:15:00", id);
  const start = Date.parse(osloDayStartIso(todayIso()));
  setTestState({
    cancelledJourneys: new Set(),
    cancellationsFetchedAt: start + (20 * 60 + 30) * 60 * 1000,
    signalLog: {
      days: {
        [todayIso()]: [{ id, from: "Standal", to: "Trandal", departure: "20:00:00", status: "skipped" }],
      },
    },
  });
  assert.equal(signalVerdict(trip, null, 20 * 60 + 10), "skipped");
  assert.equal(signalIsBooked(trip, 20 * 60 + 10), false);
});

test("logga ikkje utført blir køyrd dersom ferja likevel har lagt frå kai", () => {
  const id = "MOR:ServiceJourney:1136_128_9150000047474268";
  const trip = signalLeg("Standal", "Trandal", "20:00:00", "20:15:00", id);
  const live = freshLive({
    journeyRef: id,
    originAimed: "2026-10-01T20:00:00+02:00",
    atStop: false,
    stopName: "Trandal",
    actualDeparture: "2026-10-01T20:02:00+02:00",
    latitude: 62.263,
    longitude: 6.46,
  });
  setTestState({
    live,
    signalLog: {
      days: {
        [todayIso()]: [{ id, from: "Standal", to: "Trandal", departure: "20:00:00", status: "skipped" }],
      },
    },
  });
  assert.equal(signalVerdict(trip, live, 20 * 60 + 10, [trip]), "running");
  assert.equal(signalIsBooked(trip, 20 * 60 + 10), false);
});

test("kall utan avlysing etter fristen er ikkje bestilt", () => {
  const id = "MOR:ServiceJourney:1136_booked";
  const trip = signalLeg("Standal", "Trandal", "13:00:00", "13:15:00", id);
  const start = Date.parse(osloDayStartIso(todayIso()));
  setTestState({
    cancelledJourneys: new Set(),
    seenJourneys: new Set([id]),
    cancellationsFetchedAt: start + (12 * 60 + 30) * 60 * 1000,
  });
  assert.equal(signalIsBooked(trip, 12 * 60 + 30), false);
  // Fristen er ute, men avgangstida er ikkje nådd: ikkje «ikkje utført» enno.
  assert.equal(signalVerdict(trip, null, 12 * 60 + 30), null);
  setTestState({
    cancelledJourneys: new Set(),
    seenJourneys: new Set([id]),
    actualDepartures: new Map([[id, `${todayIso()}T13:01:00+02:00`]]),
    cancellationsFetchedAt: start + (13 * 60 + 5) * 60 * 1000,
    confirmedBooked: new Set(),
  });
  assert.equal(signalIsBooked(trip, 13 * 60 + 5), true);
  setTestState({ actualDepartures: new Map(), seenJourneys: new Set() });
  assert.equal(signalIsBooked(trip, 13 * 60 + 5), true);
  setTestState({
    cancelledJourneys: new Set([id]),
    seenJourneys: new Set([id]),
    actualDepartures: new Map([[id, `${todayIso()}T13:01:00+02:00`]]),
    confirmedBooked: new Set([id]),
  });
  assert.equal(signalIsBooked(trip, 13 * 60 + 5), false);
  assert.equal(signalVerdict(trip, null, 13 * 60 + 5), "skipped");
});

test("open kall etter fristen blir ikkje hugsa som bestilt", () => {
  const id = "MOR:ServiceJourney:1136_102_9150000047474169";
  const trip = signalLeg("Standal", "Trandal", "06:45:00", "07:00:00", id);
  const start = Date.parse(osloDayStartIso(todayIso()));
  setTestState({
    cancelledJourneys: new Set(),
    seenJourneys: new Set([id]),
    cancellationsFetchedAt: start + (6 * 60 + 50) * 60 * 1000,
  });
  assert.equal(signalIsBooked(trip, 7 * 60 + 6), false);
  setTestState({
    actualDepartures: new Map([[id, `${todayIso()}T06:46:00+02:00`]]),
  });
  assert.equal(signalIsBooked(trip, 7 * 60 + 6), true);
  setTestState({ seenJourneys: new Set(), actualDepartures: new Map() });
  assert.equal(signalIsBooked(trip, 7 * 60 + 6), true);
});

test("retur i sanntid gjer ikkje ein uttur utan avgangsbevis om til bestilt", () => {
  const outId = "MOR:ServiceJourney:1136_102_9150000047474169";
  const backId = "MOR:ServiceJourney:1136_101_9150000046366323";
  const out = signalLeg("Standal", "Trandal", "06:45:00", "07:00:00", outId);
  const back = signalLeg("Trandal", "Standal", "07:05:00", "07:20:00", backId);
  const live = freshLive({
    journeyRef: backId,
    originAimed: `${todayIso()}T07:05:00+02:00`,
    atStop: false,
    stopName: "Standal",
    actualDeparture: `${todayIso()}T07:06:00+02:00`,
    latitude: 62.263,
    longitude: 6.46,
    destination: "Standal",
  });
  setTestState({
    live,
    seenJourneys: new Set([outId, backId]),
    routes: {
      lines: {
        1136: {
          legs: [out, back].map((leg) => ({ ...leg, activeDates: [todayIso()] })),
        },
      },
    },
  });
  // Returen går frå Trandal, så ferja kom dit. Utturen er ikkje bestilt, men heller ikkje «ikkje utført».
  assert.equal(signalVerdict(out, live, 7 * 60 + 6, [out, back]), null);
  assert.equal(signalIsBooked(out, 7 * 60 + 6), false);
  assert.equal(signalIsBooked(back, 7 * 60 + 6), true);
  setTestState({
    signalLog: {
      days: {
        [todayIso()]: [
          {
            id: outId,
            from: "Standal",
            to: "Trandal",
            departure: "06:45:00",
            status: "booked",
            evidence: "departed",
            observedAt: `${todayIso()}T06:46:00+02:00`,
          },
        ],
      },
    },
  });
  assert.equal(signalIsBooked(out, 7 * 60 + 6), false);
  assert.notEqual(signalVerdict(out, live, 7 * 60 + 6, [out, back]), "skipped");
});

test("detaljane seier at bestilt ikkje er tidspunktet nokon ringde", () => {
  const id = "MOR:ServiceJourney:1136_booked";
  const trip = signalLeg("Standal", "Trandal", "13:00:00", "13:15:00", id);
  const start = Date.parse(osloDayStartIso(todayIso()));
  setTestState({
    cancelledJourneys: new Set(),
    seenJourneys: new Set([id]),
    cancellationsFetchedAt: start + (12 * 60 + 30) * 60 * 1000,
    signalLog: {
      days: {
        [todayIso()]: [
          {
            id,
            from: "Standal",
            to: "Trandal",
            departure: "13:00:00",
            status: "booked",
            observedAt: "2026-10-02T12:30:00+02:00",
          },
        ],
      },
    },
  });
  assert.notEqual(departureDetail(trip, 12 * 60 + 40).phase, "booked");
  setTestState({
    signalLog: {
      days: {
        [todayIso()]: [
          {
            id,
            from: "Standal",
            to: "Trandal",
            departure: "13:00:00",
            status: "booked",
            evidence: "departed",
            observedAt: `${todayIso()}T13:01:00+02:00`,
          },
        ],
      },
    },
  });
  const detail = departureDetail(trip, 13 * 60 + 10);
  assert.equal(detail.phase, "booked");
  assert.equal(detail.observedAt, `${todayIso()}T13:01:00+02:00`);
  assert.equal(detail.phone.replace(/\s/g, ""), "91669340");
});

test("før fristen veit detaljane ikkje om turen er tinga", () => {
  const trip = signalLeg("Standal", "Trandal", "13:00:00", "13:15:00");
  assert.equal(departureDetail(trip, 11 * 60).phase, "open");
});

test("signalloggen er for sein berre i vaktvindauget", () => {
  const at = (iso) => Date.parse(iso);
  assert.equal(
    signalLogStale(at("2026-10-04T10:00:00Z"), { updatedAt: "2026-10-04T09:40:00Z" }),
    false
  );
  assert.equal(
    signalLogStale(at("2026-10-04T10:00:00Z"), { updatedAt: "2026-10-04T08:00:00Z" }),
    true
  );
  assert.equal(
    signalLogStale(at("2026-10-04T02:00:00Z"), { updatedAt: "2026-10-03T21:30:00Z" }),
    false
  );
  assert.equal(signalLogStale(at("2026-10-04T10:00:00Z"), {}), true);
  assert.equal(signalLogStale(at("2026-10-04T10:00:00Z"), { updatedAt: "" }), true);
  assert.equal(
    signalLogStale(at("2026-10-04T04:30:00Z"), { updatedAt: "2026-10-03T21:30:00Z" }),
    false
  );
  assert.equal(
    signalLogStale(at("2026-10-04T05:15:00Z"), { updatedAt: "2026-10-03T21:30:00Z" }),
    true
  );
});

test("ein observasjon i tide tel sjølv om hjarteslaget seinare er for gammalt", () => {
  const id = "MOR:ServiceJourney:1136_102_9150000047474169";
  const trip = signalLeg("Standal", "Trandal", "06:45:00", "07:00:00", id);
  setTestState({
    signalLog: {
      updatedAt: "2026-10-04T06:50:00+02:00",
      days: {
        [todayIso()]: [
          {
            id,
            from: "Standal",
            to: "Trandal",
            departure: "06:45:00",
            status: "booked",
            evidence: "departed",
            observedAt: `${todayIso()}T06:46:00+02:00`,
          },
        ],
      },
    },
  });
  assert.equal(signalIsBooked(trip, 12 * 60), true);
  assert.equal(signalLogStale(Date.parse("2026-10-04T10:00:00Z")), true);
  setTestState({
    confirmedBooked: new Set(),
    signalLog: {
      updatedAt: "2026-10-04T06:50:00+02:00",
      days: {
        [todayIso()]: [
          {
            id,
            from: "Standal",
            to: "Trandal",
            departure: "06:45:00",
            status: "booked",
            observedAt: `${todayIso()}T06:50:00+02:00`,
          },
        ],
      },
    },
  });
  assert.equal(signalIsBooked(trip, 12 * 60), false);
});

test("logg og Entur-svar etter ankomst gjer ikkje turen bestilt", () => {
  const id = "MOR:ServiceJourney:1136_707_9150000046319059";
  const trip = signalLeg("Sæbø", "Skår", "10:50:00", "11:10:00", id);
  const start = Date.parse(osloDayStartIso(todayIso()));
  setTestState({
    cancelledJourneys: new Set(),
    seenJourneys: new Set([id]),
    cancellationsFetchedAt: start + (12 * 60 + 19) * 60 * 1000,
    signalLog: {
      days: {
        [todayIso()]: [
          {
            id,
            from: "Sæbø",
            to: "Skår",
            departure: "10:50:00",
            status: "booked",
            observedAt: `${todayIso()}T12:19:00+02:00`,
          },
        ],
      },
    },
  });
  assert.equal(signalIsBooked(trip, 12 * 60 + 19), false);
  const early = signalLeg("Skår", "Sæbø", "11:20:00", "11:40:00", "MOR:ServiceJourney:1136_702");
  setTestState({
    cancelledJourneys: new Set(),
    seenJourneys: new Set(["MOR:ServiceJourney:1136_702"]),
    cancellationsFetchedAt: start + (10 * 60 + 25) * 60 * 1000,
    confirmedBooked: new Set(),
    actualDepartures: new Map(),
  });
  assert.equal(signalIsBooked(early, 10 * 60 + 25), false);
  setTestState({
    actualDepartures: new Map([["MOR:ServiceJourney:1136_702", `${todayIso()}T11:21:00+02:00`]]),
  });
  assert.equal(signalIsBooked(early, 11 * 60 + 25), true);
});

test("svar frå før fristen gjer ikkje ein gått signaltur bestilt", () => {
  const id = "MOR:ServiceJourney:1136_102_9150000047474169";
  const trip = signalLeg("Standal", "Trandal", "06:45:00", "07:00:00", id);
  const start = Date.parse(osloDayStartIso(todayIso()));
  setTestState({
    seenJourneys: new Set([id]),
    cancellationsFetchedAt: start + 5 * 60 * 60 * 1000,
  });
  assert.equal(signalIsBooked(trip, 7 * 60 + 6), false);
});

test("avlyst signaltur før avgang seier ikkje at ferja ligg ved kai", () => {
  const viaId = "MOR:ServiceJourney:1136_705_9150000047476817";
  const toSkarId = "MOR:ServiceJourney:1136_707_9150000046319059";
  const backId = "MOR:ServiceJourney:1136_702_9150000046318658";
  const legs = [
    leg("Standal", "Trandal", "10:00:00", "10:20:00"),
    signalLeg("Trandal", "Sæbø", "10:20:00", "10:50:00", viaId),
    signalLeg("Sæbø", "Skår", "10:50:00", "11:10:00", toSkarId),
    signalLeg("Skår", "Sæbø", "11:20:00", "11:40:00", backId),
  ];
  const now = 10 * 60 + 24;
  setTestState({ cancelledJourneys: new Set([viaId, toSkarId]) });
  assert.equal(signalVerdict(legs[1], null, now, legs), "skipped");
  assert.equal(signalVerdict(legs[2], null, now, legs), "skipped");
  // Returen frå Skår er ikkje avlyst. Er han tinga, går ferja dit tom, så han er ikkje «ikkje utført».
  assert.equal(signalVerdict(legs[3], null, now, legs), null);
  assert.equal(signalObservedAtQuay(legs[1], null, now, legs), false);
  assert.equal(signalObservedAtQuay(legs[2], null, now, legs), false);
  const status = currentStatus(legs, now);
  assert.equal(status.text, "Ferja ligg til kai på Trandal");
  assert.equal(status.underway, undefined);
  assert.doesNotMatch(status.text, /utan passasjerar/);
});

test("avlyst signaltur som enno ligg ved kai etter avgang blir merkt", () => {
  const id = "MOR:ServiceJourney:1136_705_9150000047476817";
  const trip = signalLeg("Trandal", "Sæbø", "10:20:00", "10:50:00", id);
  const live = freshLive({
    journeyRef: id,
    originAimed: "2026-10-04T10:20:00+02:00",
    atStop: true,
    stopName: "Trandal ferjekai",
    latitude: 62.260997,
    longitude: 6.500688,
    destination: "Sæbø",
    delayMinutes: 1,
  });
  const now = 10 * 60 + 24;
  setTestState({ live, cancelledJourneys: new Set([id]) });
  assert.equal(signalVerdict(trip, live, now, [trip]), "skipped");
  assert.equal(signalObservedAtQuay(trip, live, now, [trip]), true);
  assert.equal(signalObservedAtQuay(trip, live, 10 * 60 + 10, [trip]), false);
});

test("seinare kjøyretur gjev ikkje merknad om kai", () => {
  const live = freshLive({
    journeyRef: "MOR:ServiceJourney:1136_104_regular",
    originAimed: "2026-10-01T07:40:00+02:00",
    atStop: false,
    stopName: "Trandal",
    latitude: 62.263,
    longitude: 6.46,
    delayMinutes: 0,
  });
  const legs = [
    ...signalMorning.slice(0, 2),
    {
      id: "MOR:ServiceJourney:1136_104_regular#0",
      from: "Standal",
      to: "Trandal",
      departure: "07:40:00",
      arrival: "07:55:00",
    },
  ];
  assert.equal(signalVerdict(legs[0], live, 8 * 60, legs), null);
  assert.equal(signalObservedAtQuay(legs[0], live, 8 * 60, legs), false);
});

test("signaltur som ligg att på startkaien etter avgang blir merkt", () => {
  const live = freshLive();
  const now = 7 * 60 + 25;
  assert.equal(signalObservedAtQuay(signalMorning[0], live, now, signalMorning), true);
  assert.equal(signalObservedAtQuay(signalMorning[1], live, now, signalMorning), true);
  assert.equal(signalObservedAtQuay(signalMorning[0], live, 6 * 60 + 30, signalMorning), false);
});

test("avlyst signaltur blir ikkje ståande som på veg til Standal", () => {
  const outId = "MOR:ServiceJourney:1136_128_9150000047474268";
  const backId = "MOR:ServiceJourney:1136_129_9150000046366348";
  const evening = [
    leg("Standal", "Trandal", "18:45:00", "19:00:00"),
    leg("Trandal", "Standal", "19:40:00", "19:55:00"),
    signalLeg("Standal", "Trandal", "20:00:00", "20:15:00", outId),
    signalLeg("Trandal", "Standal", "20:20:00", "20:35:00", backId),
  ];
  const now = 20 * 60 + 25;
  assert.equal(ferryStatus(evening, now, evening).text, "Ferja er på veg mot Standal");
  setTestState({ cancelledJourneys: new Set([outId, backId]) });
  assert.equal(signalVerdict(evening[2], null, now, evening), "skipped");
  assert.equal(signalVerdict(evening[3], null, now, evening), "skipped");
  const status = currentStatus(evening, now);
  assert.equal(status.underway, undefined);
  assert.equal(status.short, "Ferja er ferdig for dagen på Standal");
  assert.doesNotMatch(status.text, /på veg/);
});

test("faktisk avgang frå ein annan dag tel ikkje", () => {
  const found = actualDeparturesFromPayload(
    {
      data: {
        saebo: {
          estimatedCalls: [
            {
              cancellation: false,
              aimedDepartureTime: "2026-10-04T16:50:00+02:00",
              actualDepartureTime: "2026-10-04T16:51:00+02:00",
              serviceJourney: { id: "MOR:ServiceJourney:1136_122" },
            },
            {
              cancellation: false,
              aimedDepartureTime: `${todayIso()}T16:50:00+02:00`,
              actualDepartureTime: `${todayIso()}T16:52:00+02:00`,
              serviceJourney: { id: "MOR:ServiceJourney:1136_122" },
            },
          ],
        },
      },
    },
    todayIso()
  );
  assert.equal(found.get("MOR:ServiceJourney:1136_122"), `${todayIso()}T16:52:00+02:00`);
});

test("cancelledJourneyIds plukkar berre avlyste turar", () => {
  const ids = cancelledJourneyIds({
    data: {
      standal: {
        estimatedCalls: [
          {
            cancellation: false,
            serviceJourney: { id: "MOR:ServiceJourney:1136_127_9150000046318049" },
          },
          {
            cancellation: true,
            serviceJourney: { id: "MOR:ServiceJourney:1136_128_9150000047474268" },
          },
        ],
      },
      trandal: {
        estimatedCalls: [
          {
            cancellation: true,
            serviceJourney: { id: "MOR:ServiceJourney:1136_129_9150000046366348#0" },
          },
        ],
      },
    },
  });
  assert.deepEqual(
    [...ids].sort(),
    [
      "MOR:ServiceJourney:1136_128_9150000047474268",
      "MOR:ServiceJourney:1136_129_9150000046366348",
    ]
  );
});

test("oslo-døgnet startar med rett offset", () => {
  assert.equal(osloDayStartIso("2026-10-01"), "2026-10-01T00:00:00+02:00");
  assert.equal(osloDayStartIso("2026-01-15"), "2026-01-15T00:00:00+01:00");
});

test("parseVehicleMonitoring les kai og avgang for signaltur", () => {
  const live = parseVehicleMonitoring({
    Siri: {
      ServiceDelivery: {
        VehicleMonitoringDelivery: [
          {
            VehicleActivity: {
              ValidUntilTime: "2099-01-01T00:00:00Z",
              RecordedAtTime: "2026-10-01T07:25:00+02:00",
              MonitoredVehicleJourney: {
                DestinationName: [{ value: "Trandal" }],
                Delay: "PT40M",
                OriginAimedDepartureTime: "2026-10-01T06:45:00+02:00",
                FramedVehicleJourneyRef: {
                  DatedVehicleJourneyRef: signalJourney,
                },
                VehicleLocation: { Latitude: 62.26652, Longitude: 6.42321 },
                MonitoredCall: {
                  VehicleAtStop: true,
                  StopPointName: [{ value: "Standal ferjekai" }],
                  AimedDepartureTime: "2026-10-01T06:45:00+02:00",
                  ExpectedDepartureTime: "2026-10-01T07:25:00+02:00",
                  AimedArrivalTime: "2026-10-01T07:20:00+02:00",
                  ExpectedArrivalTime: "2026-10-01T07:21:34+02:00",
                  ActualArrivalTime: "2026-10-01T07:21:34+02:00",
                },
              },
            },
          },
        ],
      },
    },
  });
  assert.equal(live.journeyRef, signalJourney);
  assert.equal(live.atStop, true);
  assert.equal(live.stopName, "Standal");
  assert.equal(live.actualDeparture, "");
  assert.equal(live.actualArrival, "2026-10-01T07:21:34+02:00");
  assert.equal(live.expectedArrival, "2026-10-01T07:21:34+02:00");
  assert.equal(live.aimedArrival, "2026-10-01T07:20:00+02:00");
  assert.equal(live.delayMinutes, 40);
  assert.equal(signalVerdict(signalMorning[0], live, 7 * 60 + 25, signalMorning), "skipped");
});

test("liveStatus krev fersk data", () => {
  assert.equal(isLiveFresh(null), false);
  assert.equal(isLiveFresh({ validUntil: "2000-01-01T00:00:00Z" }), false);
  const live = {
    destination: "Trandal",
    delayMinutes: 2,
    validUntil: "2099-01-01T00:00:00Z",
  };
  assert.equal(isLiveFresh(live), true);
  const status = liveStatus({
    destination: "Sæbø Trandal Standal",
    delayMinutes: 1,
    validUntil: "2099-01-01T00:00:00Z",
  });
  assert.equal(
    status.text,
    "Ferja er på veg mot Sæbø, om lag 1 min forsinka (sanntid frå Entur)."
  );
  assert.doesNotMatch(status.text, /Sæbø Trandal Standal/);
});

test("segling viser destinasjon og båe kaier, utan eiga ankomst-rad", () => {
  const events = buildEvents(wednesday, null);
  assert.ok(events.every((event) => event.kind !== "arr"));
  const first = events.find((event) => event.kind === "dep");
  assert.deepEqual(first.quays, ["Standal", "Trandal"]);
  assert.equal(first.leg.to, "Trandal");
  assert.equal(first.at, 7 * 60 + 40);
});

test("ved valt frå-stad står berre avgangar derifrå, ikkje dempa innkomst", () => {
  setTestState({ fromFilter: "Sæbø" });
  const events = buildEvents(wednesday, null);
  assert.ok(events.every((event) => event.kind !== "arr"));
  const outbound = events.find(
    (event) => event.kind === "dep" && event.leg.from === "Sæbø" && event.leg.to === "Trandal"
  );
  const inboundAsDep = events.find(
    (event) => event.kind === "dep" && event.leg.from === "Trandal" && event.leg.to === "Sæbø"
  );
  assert.equal(outbound.at, 8 * 60 + 35);
  assert.equal(inboundAsDep, undefined);
  assert.ok(events.filter((event) => event.kind === "dep").every((event) => event.leg.from === "Sæbø"));
});

test("til-stad viser alle turar som endar der", () => {
  setTestState({ toFilter: "Trandal" });
  const events = buildEvents(wednesday, null).filter((event) => event.kind === "dep");
  assert.ok(events.length > 1);
  assert.ok(events.every((event) => event.leg.to === "Trandal"));
  assert.ok(events.some((event) => event.leg.from === "Standal"));
  assert.ok(events.some((event) => event.leg.from === "Sæbø"));
  assert.equal(
    events.find((event) => event.leg.from === "Trandal"),
    undefined
  );
});

test("frå og til saman viser berre den strekninga", () => {
  setTestState({ fromFilter: "Standal", toFilter: "Trandal" });
  const events = buildEvents(wednesday, null).filter((event) => event.kind === "dep");
  assert.ok(events.length >= 1);
  assert.ok(events.every((event) => event.leg.from === "Standal" && event.leg.to === "Trandal"));
});

test("frå og til følgjer mellomstopp på same ferje", () => {
  const legs = [
    leg("Sæbø", "Skår", "08:35:00", "08:55:00"),
    leg("Skår", "Sæbø", "08:55:00", "09:15:00"),
    leg("Sæbø", "Trandal", "09:20:00", "09:45:00"),
    leg("Trandal", "Standal", "09:45:00", "10:00:00"),
  ];
  setTestState({ fromFilter: "Skår", toFilter: "Standal" });
  const events = buildEvents(legs, null).filter((event) => event.kind === "dep");
  assert.deepEqual(
    events.map((event) => `${event.leg.from}→${event.leg.to}`),
    ["Skår→Sæbø", "Sæbø→Trandal", "Trandal→Standal"]
  );
});

test("frå Sæbø til Standal hoppar over Skår-vendinga", () => {
  const legs = [
    leg("Sæbø", "Skår", "08:35:00", "08:55:00"),
    leg("Skår", "Sæbø", "08:55:00", "09:15:00"),
    leg("Sæbø", "Trandal", "09:20:00", "09:45:00"),
    leg("Trandal", "Standal", "09:45:00", "10:00:00"),
  ];
  setTestState({ fromFilter: "Sæbø", toFilter: "Standal" });
  const events = buildEvents(legs, null).filter((event) => event.kind === "dep");
  assert.equal(events[0].leg.from, "Sæbø");
  assert.equal(events[0].leg.to, "Trandal");
  assert.equal(events[0].leg.departure, "09:20:00");
  assert.ok(events.every((event) => event.leg.from !== "Skår"));
});

test("Sæbø-pendel blir ventetid, ikkje eigne avgongar", () => {
  const legs = [
    leg("Standal", "Trandal", "15:50:00", "16:05:00"),
    leg("Trandal", "Sæbø", "16:05:00", "16:25:00"),
    leg("Sæbø", "Leknes", "16:30:00", "16:45:00"),
    leg("Leknes", "Sæbø", "16:45:00", "17:00:00"),
    leg("Sæbø", "Leknes", "17:00:00", "17:15:00"),
    leg("Leknes", "Sæbø", "17:15:00", "17:30:00"),
    leg("Sæbø", "Leknes", "17:30:00", "17:45:00"),
    leg("Leknes", "Skår", "17:45:00", "18:00:00"),
  ];
  setTestState({ fromFilter: "Standal", toFilter: "Skår" });
  const events = buildEvents(legs, null).filter((event) => matchesStop(event));
  assert.deepEqual(
    events.filter((event) => event.kind === "dep").map((event) => `${event.leg.from}→${event.leg.to}`),
    ["Standal→Trandal", "Trandal→Sæbø", "Sæbø→Leknes", "Leknes→Skår"]
  );
  const wait = events.find((event) => event.kind === "wait");
  assert.ok(wait);
  assert.equal(wait.stay.quay, "Sæbø");
  assert.equal(wait.stay.minutes, 65);
  assert.equal(wait.stay.from, "16:25:00");
  assert.equal(wait.stay.until, "17:30:00");
  assert.ok(events.every((event) => event.leg?.from !== "Leknes" || event.leg.to === "Skår"));
});

test("ferjeskifte på Sæbø får ventetid mellom tabellane", () => {
  const legs = [
    { ...leg("Leknes", "Sæbø", "08:30:00", "08:43:00"), table: "1135" },
    { ...leg("Sæbø", "Leknes", "08:50:00", "09:03:00"), table: "1135" },
    { ...leg("Sæbø", "Trandal", "09:20:00", "09:45:00"), table: "1136" },
    { ...leg("Trandal", "Standal", "09:45:00", "10:00:00"), table: "1136" },
  ];
  setTestState({ fromFilter: "Leknes", toFilter: "Standal" });
  const events = buildEvents(legs, null).filter((event) => matchesStop(event));
  assert.deepEqual(
    events.filter((event) => event.kind === "dep").map((event) => `${event.leg.from}→${event.leg.to}`),
    ["Leknes→Sæbø", "Sæbø→Trandal", "Trandal→Standal"]
  );
  const wait = events.find((event) => event.kind === "wait");
  assert.ok(wait);
  assert.equal(wait.stay.quay, "Sæbø");
  assert.equal(wait.stay.minutes, 37);
});

test("frå-til-reise viser ikkje tabellskifte mellom ferjene", () => {
  const legs = [
    { ...leg("Skår", "Sæbø", "08:55:00", "09:15:00"), table: "1136" },
    { ...leg("Leknes", "Sæbø", "09:00:00", "09:13:00"), table: "1135" },
    { ...leg("Sæbø", "Trandal", "09:20:00", "09:45:00"), table: "1136" },
    { ...leg("Trandal", "Standal", "09:45:00", "10:00:00"), table: "1136" },
  ];
  setTestState({ fromFilter: "Skår", toFilter: "Standal" });
  const events = buildEvents(legs, null).filter((event) => matchesStop(event));
  assert.ok(events.every((event) => event.kind === "dep"));
  assert.ok(events.some((event) => event.leg.from === "Skår"));
  assert.ok(events.some((event) => event.leg.to === "Standal"));
});

test("berre til-filter viser ikkje skifte-banner mellom 1135 og 1136", () => {
  const legs = [
    { ...leg("Sæbø", "Leknes", "06:30:00", "06:43:00"), table: "1135" },
    { ...leg("Standal", "Trandal", "07:40:00", "07:55:00"), table: "1136" },
    { ...leg("Sæbø", "Leknes", "08:30:00", "08:43:00"), table: "1135" },
    { ...leg("Sæbø", "Trandal", "08:35:00", "08:55:00"), table: "1136" },
    { ...leg("Skår", "Sæbø", "08:55:00", "09:15:00"), table: "1136" },
  ];
  setTestState({ toFilter: "Trandal" });
  const built = buildEvents(legs, null);
  assert.equal(
    built.filter((event) => event.kind === "split").length,
    0,
    "1135 og 1136 skal ikkje skape tabellskifte når dei berre er fletta for filteret"
  );
  const events = built.filter((event) => matchesStop(event));
  assert.ok(events.every((event) => event.kind !== "split"));
  assert.deepEqual(
    events.filter((event) => event.kind === "dep").map((event) => `${event.leg.from}→${event.leg.to}`),
    ["Standal→Trandal", "Sæbø→Trandal"]
  );
});

test("byte frå og til snur filteret", () => {
  setTestState({ fromFilter: "Trandal", toFilter: null });
  swapPlaceFilters();
  const toTrandal = buildEvents(wednesday, null).filter((event) => event.kind === "dep");
  assert.ok(toTrandal.length > 0);
  assert.ok(toTrandal.every((event) => event.leg.to === "Trandal"));
  assert.ok(toTrandal.every((event) => matchesLegPlaces(event.leg)));
  setTestState({ fromFilter: "Standal", toFilter: "Trandal" });
  swapPlaceFilters();
  const swapped = buildEvents(wednesday, null).filter((event) => event.kind === "dep");
  assert.ok(swapped.length > 0);
  assert.ok(swapped.every((event) => event.leg.from === "Trandal" && event.leg.to === "Standal"));
});

test("tomt frå-til-val får eiga melding", () => {
  setTestState({ fromFilter: "Trandal", toFilter: "Store Kalvøy" });
  assert.equal(emptyPlaceMessage(), "Ingen turar frå Trandal til Store Kalvøy denne dagen.");
  setTestState({ fromFilter: null, toFilter: "Trandal" });
  assert.equal(emptyPlaceMessage(), "Ingen turar til Trandal denne dagen.");
  setTestState({ fromFilter: "Standal", toFilter: null });
  assert.equal(emptyPlaceMessage(), "Ingen turar frå Standal denne dagen.");
});

test("kort vending er ikkje liggetid, lengre opphald er", () => {
  assert.equal(
    layoverAfter(
      leg("Leknes", "Sæbø", "13:00:00", "13:13:00"),
      leg("Sæbø", "Leknes", "13:15:00", "13:28:00")
    ),
    null
  );
  assert.equal(
    layoverAfter(
      leg("Leknes", "Sæbø", "13:00:00", "13:13:00"),
      leg("Sæbø", "Leknes", "13:32:00", "13:45:00")
    ),
    null
  );
  const stay = layoverAfter(
    leg("Leknes", "Sæbø", "13:00:00", "13:13:00"),
    leg("Sæbø", "Leknes", "13:33:00", "13:46:00")
  );
  assert.equal(stay.quay, "Sæbø");
  assert.equal(stay.minutes, 20);
  assert.equal(
    layoverAfter(
      leg("Valderøya", "Store Kalvøy", "11:10:00", "11:30:00"),
      leg("Standal", "Trandal", "14:40:00", "14:55:00")
    ),
    null
  );
});

test("tabellen merkar liggetid ved matpause, ikkje innkomst-rad", () => {
  const legs = [
    leg("Sæbø", "Leknes", "09:00:00", "09:13:00"),
    leg("Leknes", "Sæbø", "09:15:00", "09:28:00"),
    leg("Sæbø", "Leknes", "10:30:00", "10:43:00"),
  ];
  const events = buildEvents(legs, null);
  assert.ok(events.every((event) => event.kind !== "arr"));
  const stay = events.find((event) => event.kind === "layover");
  assert.ok(stay);
  assert.equal(stay.quays[0], "Sæbø");
  assert.equal(stay.at, 9 * 60 + 28);
  assert.equal(stay.until, 10 * 60 + 30);
  assert.equal(stay.stay.minutes, 62);
  assert.equal(
    events.filter((event) => event.kind === "layover" && event.quays[0] === "Leknes").length,
    0
  );
  assert.equal(keepTimelineEvent(stay, events, 9 * 60 + 50), true);
  assert.equal(keepTimelineEvent(stay, events, 10 * 60 + 30), false);
  setTestState({ fromFilter: "Leknes" });
  const leknes = buildEvents(legs, null);
  assert.ok(leknes.every((event) => event.kind !== "layover"));
  assert.ok(leknes.every((event) => event.kind !== "arr"));
  setTestState({ fromFilter: "Sæbø" });
  const saebo = buildEvents(legs, null);
  assert.equal(saebo.filter((event) => event.kind === "layover").length, 1);
});

test("liggetid visest òg når ankomsttider er skjulte", () => {
  setTestState({ hideArrivals: true });
  const events = buildEvents(
    [
      leg("Leknes", "Sæbø", "09:15:00", "09:28:00"),
      leg("Sæbø", "Leknes", "10:30:00", "10:43:00"),
    ],
    null
  );
  assert.equal(events.filter((event) => event.kind === "layover").length, 1);
});

test("onsdag har liggetid på Store Kalvøy, ikkje fem-minutts vending", () => {
  const stays = buildEvents(wednesday, null).filter((event) => event.kind === "layover");
  assert.equal(stays.length, 1);
  assert.equal(stays[0].quays[0], "Store Kalvøy");
  assert.equal(stays[0].stay.minutes, 40);
});

test("flytting kjem etter siste segling", () => {
  const events = buildEvents(wednesday, null).sort(compareTimelineEvents);
  const lastDep = events.filter((event) => event.kind === "dep").at(-1);
  const lastTransfer = events.filter((event) => event.kind === "transfer").at(-1);
  assert.ok(lastDep);
  assert.ok(lastTransfer);
  assert.equal(lastTransfer.at, 19 * 60 + 45);
  assert.ok(lastTransfer.at >= lastDep.at);
});

test("segling er synleg til ankomst når alle stopp er valt", () => {
  const trip = [leg("Standal", "Trandal", "07:40:00", "07:55:00")];
  const events = buildEvents(trip, null);
  const dep = events.find((event) => event.kind === "dep");
  assert.equal(keepTimelineEvent(dep, events, 7 * 60 + 50), true);
  assert.equal(keepTimelineEvent(dep, events, 7 * 60 + 55), false);
  assert.equal(pastDepartureCount(events, 7 * 60 + 50), 0);
  assert.equal(pastDepartureCount(events, 7 * 60 + 55), 1);
});

test("NO-status får liggetid-tekst og amber når ferja ligg i eit slikt opphald", () => {
  const status = ferryStatus(wednesday, 11 * 60 + 50, wednesday);
  assert.equal(status.layover, true);
  assert.equal(status.underway, undefined);
  assert.equal(status.short, "Ferja ligg til kai på Store Kalvøy");
  assert.equal(
    status.text,
    "Ferja ligg til kai på Store Kalvøy. Liggetid 40 min, til 12:10."
  );
  const stays = buildEvents(wednesday, null).filter((event) => event.kind === "layover");
  assert.equal(stays.length, 1);
  assert.equal(keepTimelineEvent(stays[0], stays, 11 * 60 + 50, status), false);
  assert.equal(keepTimelineEvent(stays[0], stays, 11 * 60 + 50), true);
});

test("kort vending gjev vanleg kai-status, ikkje liggetid i NO", () => {
  const legs = [
    leg("Sæbø", "Leknes", "09:00:00", "09:13:00"),
    leg("Leknes", "Sæbø", "09:15:00", "09:28:00"),
  ];
  const status = ferryStatus(legs, 9 * 60 + 14, legs);
  assert.equal(status.layover, undefined);
  assert.equal(status.text, "Ferja ligg til kai på Leknes");
  assert.equal(layoverAfter(legs[0], legs[1]), null);
});

test("I dag står i knappen, ikkje i overskrifta", () => {
  assert.doesNotMatch(headingDay(todayIso()), /^I dag/);
  assert.doesNotMatch(headingDay("2020-01-15"), /^I dag/);
});

test("meldingar for valt samband kjem øvst", () => {
  const standal = {
    heading: "Standal-Trandal-Valderøya-Store Kalvøy",
    text: "Verkstad i veka",
    connectionNumber: 132,
    severity: "info",
  };
  const leknes = {
    heading: "Leknes-Sæbø",
    text: "Normal drift",
    connectionNumber: 134,
    severity: "cancelled",
  };
  const other = {
    heading: "Festøy-Hundeidvik",
    text: "innstilt",
    connectionNumber: 1049,
    severity: "cancelled",
  };
  assert.equal(messageRouteScore(standal, "1136"), 0);
  assert.equal(messageRouteScore(leknes, "1136"), 3);
  assert.equal(messageRouteScore(leknes, "1135"), 0);
  assert.equal(messageRouteScore(standal, "1135"), 3);
  const sorted1136 = sortMessagesForRoute([leknes, other, standal], "1136");
  assert.equal(sorted1136[0].heading, standal.heading);
  const sorted1135 = sortMessagesForRoute([standal, other, leknes], "1135");
  assert.equal(sorted1135[0].heading, leknes.heading);
});

test("nyaste melding kjem føre eldre innstilling med same relevans", () => {
  const olderCancel = {
    heading: "Festøya-Hundeidvika",
    text: "Grunna driftsproblem vert følgjande avgangar innstilt",
    severity: "cancelled",
    publishedAt: "2026-09-27T13:12:59+02:00",
  };
  const newerNormal = {
    heading: "Festøya-Hundeidvika",
    text: "Det vert normal drift i sambandet frå kl. 14:00.",
    severity: "normal",
    publishedAt: "2026-09-27T13:46:03+02:00",
  };
  const sorted = sortMessagesForRoute([olderCancel, newerNormal], "1136");
  assert.equal(sorted[0].text, newerNormal.text);
  assert.equal(sorted[1].text, olderCancel.text);
});

test("melding for valt samband ligg over nyare melding om anna samband", () => {
  const olderRoute = {
    heading: "Standal-Trandal-Valderøya-Store Kalvøy",
    text: "Verkstad",
    connectionNumber: 132,
    severity: "info",
    publishedAt: "2026-09-27T08:00:00+02:00",
  };
  const newerOther = {
    heading: "Festøya-Hundeidvika",
    text: "innstilt",
    severity: "cancelled",
    publishedAt: "2026-09-27T14:00:00+02:00",
  };
  const sorted = sortMessagesForRoute([newerOther, olderRoute], "1136");
  assert.equal(sorted[0].heading, olderRoute.heading);
});

test("sanntidsvindauge er fyrste avgang til siste ankomst", () => {
  setTestState({
    routes: { lines: { 1136: { legs: wednesday } } },
  });
  const win = serviceWindowMinutes("2026-08-26");
  assert.equal(win.start, 7 * 60 + 40);
  assert.equal(win.end, 19 * 60 + 45);
  const midday = Date.parse("2026-08-26T12:00:00+02:00");
  const night = Date.parse("2026-08-26T23:40:00+02:00");
  const early = Date.parse("2026-08-26T05:00:00+02:00");
  assert.equal(shouldFetchLive(midday), true);
  assert.equal(shouldFetchLive(night), false);
  assert.equal(shouldFetchLive(early), false);
});

test("kombi spør 1136 fyrst, 1135 berre som reserveløype", () => {
  assert.deepEqual(liveFetchUrls("1136"), [
    "https://api.entur.io/realtime/v1/rest/vm?datasetId=MOR&LineRef=MOR:Line:1136",
  ]);
  assert.deepEqual(liveFetchUrls("1135"), [
    "https://api.entur.io/realtime/v1/rest/vm?datasetId=MOR&LineRef=MOR:Line:1135",
  ]);
  const kombi = liveFetchUrls("kombi");
  assert.equal(kombi.length, 2);
  assert.match(kombi[0], /1136/);
  assert.match(kombi[1], /1135/);
});

test("Entur-feil aukar backoff", () => {
  setTestState({
    routes: { lines: { 1136: { legs: wednesday } } },
  });
  const midday = Date.parse("2026-08-26T12:00:00+02:00");
  assert.equal(shouldFetchLive(midday), true);
  noteLiveFailure(midday);
  assert.equal(liveBlockedUntil(), midday + 60_000);
  assert.equal(shouldFetchLive(midday + 10_000), false);
  noteLiveFailure(midday);
  assert.equal(liveBlockedUntil(), midday + 120_000);
});

/** Rutetabell med turar i dag frå tidleg til seint, så shouldFetchLive() er sann no. */
function allDayRoutes() {
  const today = todayIso();
  return {
    lines: {
      1136: {
        legs: [
          leg("Standal", "Trandal", "00:01:00", "00:20:00", [today]),
          leg("Trandal", "Standal", "23:30:00", "23:50:00", [today]),
        ],
      },
    },
  };
}

const EMPTY_VM = { Siri: { ServiceDelivery: { VehicleMonitoringDelivery: [{}] } } };

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  };
}

/** Køyr loadLivePosition() med falsk fetch. `vm` svarar på VM-kalla. */
async function runLiveFetch(vm) {
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === "POST") return jsonResponse({ data: {} });
    return vm(url);
  };
  console.error = () => {};
  try {
    await loadLivePosition();
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousError;
  }
}

test("tomt VM-svar gir «ingen posisjon», ikkje «fekk ikkje kontakt»", async () => {
  setTestState({ routes: allDayRoutes() });
  await runLiveFetch(async () => jsonResponse(EMPTY_VM));
  assert.equal(positionNoteKey(), "position.planned");
  assert.equal(t(positionNoteKey()), "Entur har ingen posisjon for ferja no. Posisjonen er rekna ut frå rutetabellen.");
  assert.equal(liveBlockedUntil(), 0);
});

test("nettverksfeil (struping utan CORS) gir «fekk ikkje kontakt» og backoff", async () => {
  setTestState({ routes: allDayRoutes() });
  const before = Date.now();
  await runLiveFetch(async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.equal(positionNoteKey(), "position.offline");
  assert.equal(
    t(positionNoteKey()),
    "Fekk ikkje kontakt med Entur, prøver igjen om litt. Posisjonen er rekna ut frå rutetabellen."
  );
  assert.ok(liveBlockedUntil() >= before + 60_000);
});

test("feilstatus og ugyldig JSON frå Entur gir òg «fekk ikkje kontakt»", async () => {
  const failures = [
    async () => jsonResponse(null, 429),
    async () => jsonResponse(null, 403),
    async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    }),
  ];
  for (const vm of failures) {
    resetTestState();
    setTestState({ routes: allDayRoutes() });
    await runLiveFetch(vm);
    assert.equal(positionNoteKey(), "position.offline");
  }
});

test("vellukka kall etter feil tek bort «fekk ikkje kontakt»", async () => {
  setTestState({ routes: allDayRoutes() });
  await runLiveFetch(async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.equal(positionNoteKey(), "position.offline");
  setTestState({ liveFetchedAt: 0, liveBlockedUntil: 0 });
  await runLiveFetch(async () => jsonResponse(EMPTY_VM));
  assert.equal(positionNoteKey(), "position.planned");
});

test("fersk sanntid gir sanntidsfotnote sjølv etter feil", () => {
  setTestState({
    liveFailed: true,
    live: { destination: "Trandal", validUntil: new Date(Date.now() + 60_000).toISOString() },
  });
  assert.equal(positionNoteKey(), "position.live");
});

test("fotnotane for posisjon finst på alle språk", () => {
  for (const lang of ["en", "de", "nn"]) {
    setLang(lang);
    for (const key of ["position.planned", "position.offline", "position.live"]) {
      assert.notEqual(t(key), key, `${lang} ${key}`);
    }
  }
});

test("signaltur etter fristen er ikkje «ikkje utført» før avgang (8. oktober kl. 19:40)", () => {
  const legs = [
    leg("Trandal", "Standal", "19:40:00", "19:55:00"),
    signalLeg("Standal", "Trandal", "20:00:00", "20:15:00", "MOR:ServiceJourney:1136_128_evening"),
    signalLeg("Trandal", "Standal", "20:20:00", "20:35:00", "MOR:ServiceJourney:1136_129_evening"),
  ];
  const live = freshLive({
    journeyRef: "MOR:ServiceJourney:1136_127_evening",
    originAimed: "2026-10-01T19:40:00+02:00",
    destination: "Standal",
    atStop: false,
    stopName: "Standal",
    delayMinutes: 0,
  });
  const now = 19 * 60 + 40;
  setTestState({ live });
  assert.equal(signalVerdict(legs[1], live, now, legs), null);
  assert.equal(signalVerdict(legs[2], live, now, legs), null);
});

test("fristen åleine gjer aldri ein signaltur «ikkje utført», same kor seint det er", () => {
  const trip = signalLeg("Standal", "Trandal", "20:00:00", "20:15:00", "MOR:ServiceJourney:1136_grace");
  setTestState({ cancelledJourneys: new Set(), seenJourneys: new Set() });
  for (const now of [19 * 60 + 30, 20 * 60 + 5, 20 * 60 + 15, 21 * 60, 23 * 60 + 59]) {
    assert.equal(signalVerdict(trip, null, now), null, `kl. ${now}`);
  }
  const detail = departureDetail(trip, 21 * 60);
  assert.equal(detail.phase, "unknown");
  assert.equal(detail.skipped, false);
});

test("ferje som ligg ved startkaien er «ikkje utført» fyrst 15 minutt etter avgang", () => {
  const live = freshLive();
  const trip = signalMorning[0];
  assert.equal(signalVerdict(trip, live, 6 * 60 + 50, signalMorning), null);
  assert.equal(signalVerdict(trip, live, 6 * 60 + 59, signalMorning), null);
  assert.equal(signalVerdict(trip, live, 7 * 60, signalMorning), "skipped");
  // Halen etter ein tur som ligg att ventar òg på slingringsmonnet til den fyrste turen.
  assert.equal(signalVerdict(signalMorning[1], live, 7 * 60 + 5, signalMorning), "skipped");
});

test("tidlegare dag utan bevis er nøytral, logga avlysing er «ikkje utført»", () => {
  const ran = signalLeg("Standal", "Trandal", "20:00:00", "20:15:00", "MOR:ServiceJourney:1136_past_ran");
  const off = signalLeg("Trandal", "Standal", "20:20:00", "20:35:00", "MOR:ServiceJourney:1136_past_off");
  setTestState({
    date: "2026-09-30",
    signalLog: {
      days: {
        "2026-09-30": [
          { id: "MOR:ServiceJourney:1136_past_off", from: "Trandal", to: "Standal", departure: "20:20:00", status: "skipped" },
        ],
      },
    },
  });
  assert.equal(signalVerdict(ran, null, 12 * 60), null);
  assert.equal(departureDetail(ran, 12 * 60).phase, "unknown");
  assert.equal(signalVerdict(off, null, 12 * 60), "skipped");
  assert.equal(departureDetail(off, 12 * 60).seenSkip, true);
});

test("avlyst tur til kaien gjer ikkje neste signaltur «ikkje utført» (ekte 4. oktober 18:35)", () => {
  // 4. oktober avlyste Entur 17:15, 17:50 og 18:15, men ikkje 18:35 Sæbø–Trandal.
  // Er ein tur tinga, går ferja tom til startkaien. Berre avlysing av turen sjølv er bevis.
  const outId = "MOR:ServiceJourney:1136_arr_out";
  const backId = "MOR:ServiceJourney:1136_arr_back";
  const legs = [
    leg("Trandal", "Standal", "19:40:00", "19:55:00"),
    signalLeg("Standal", "Trandal", "20:00:00", "20:15:00", outId),
    signalLeg("Trandal", "Standal", "20:20:00", "20:35:00", backId),
  ].map((item) => ({ ...item, activeDates: [todayIso()] }));
  setTestState({ cancelledJourneys: new Set([outId]), routes: { lines: { 1136: { legs } } } });
  for (const now of [19 * 60 + 30, 20 * 60 + 25, 20 * 60 + 50]) {
    assert.equal(signalVerdict(legs[2], null, now, legs), null, `kl. ${now}`);
  }
  assert.equal(signalVerdict(legs[1], null, 19 * 60 + 30, legs), "skipped");
  assert.equal(departureDetail(legs[2], 20 * 60 + 50).phase, "unknown");
});

// --- Avspeling av ekte dagar frå signalloggen ---------------------------------------------
// tests/fixtures/signalturar_replay.json er eit utdrag av data/signalturar.json på main.
// Rutetabellen er den faste kopien i tests/fixtures/ruter.json. Dagane blir flytta til
// «i dag» eller «i går», slik at testane ikkje er avhengige av kva dag dei køyrer.
const replay = JSON.parse(
  readFileSync(new URL("./fixtures/signalturar_replay.json", import.meta.url), "utf8")
);
const fixtureRoutes = JSON.parse(
  readFileSync(new URL("./fixtures/ruter.json", import.meta.url), "utf8")
);

function shiftDay(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const OSLO_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Oslo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function osloMinutesOf(iso) {
  const parts = OSLO_CLOCK.formatToParts(new Date(iso));
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return get("hour") * 60 + get("minute");
}

function clock(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function replayLegs(day, target) {
  return fixtureRoutes.lines["1136"].legs
    .filter((item) => item.activeDates.includes(day))
    .map((item) => ({ ...item, activeDates: [target] }));
}

function journeyOf(item) {
  return String(item.id).split("#")[0];
}

/** Turar som faktisk gjekk: gått, bestilt med faktisk avgang, eller stadfesta i chatten. */
function ranJourneys(day) {
  const ran = new Set(replay.confirmedRan?.[day] || []);
  for (const entry of replay.days[day]) {
    if (entry.status === "gått" || (entry.status === "booked" && entry.evidence === "departed")) {
      ran.add(entry.id);
    }
  }
  return ran;
}

/** Når loggen fyrst kunne ha sett oppføringa. */
function visibleFrom(entry) {
  if (entry.status === "skipped") return osloMinutesOf(entry.skippedAt || entry.observedAt);
  return osloMinutesOf(entry.observedAt || replay.updatedAt);
}

/** Tilstanden appen hadde hatt kl. `now`: loggen så langt og avlysingane loggen hadde sett. */
function replayToday(day, now, extra = {}) {
  const target = todayIso();
  const legs = replayLegs(day, target);
  const seen = replay.days[day].filter((entry) => visibleFrom(entry) <= now);
  resetTestState();
  setTestState({
    routes: { lines: { 1136: { legs } } },
    signalLog: { days: { [target]: seen } },
    cancelledJourneys: new Set(seen.filter((entry) => entry.status === "skipped").map((entry) => entry.id)),
    live: null,
    ...extra,
  });
  return legs;
}

function replayTimes(legs) {
  const times = new Set();
  for (let now = 5 * 60; now < 24 * 60; now += 10) times.add(now);
  for (const item of legs.filter((entry) => entry.signal)) {
    const dep = Number(item.departure.slice(0, 2)) * 60 + Number(item.departure.slice(3, 5));
    for (const delta of [-61, -60, -1, 0, 1, 5, 14, 15, 16, 30, 90]) {
      if (dep + delta >= 0 && dep + delta < 24 * 60) times.add(dep + delta);
    }
  }
  return [...times].sort((a, b) => a - b);
}

const REPLAY_DAYS = Object.keys(replay.days);

test("avspeling: fixturen har dagane testane ventar", () => {
  assert.deepEqual(REPLAY_DAYS, ["2026-10-02", "2026-10-04", "2026-10-05", "2026-10-07", "2026-10-08"]);
  for (const day of REPLAY_DAYS) {
    const ids = new Set(replayLegs(day, day).map(journeyOf));
    for (const entry of replay.days[day]) assert.ok(ids.has(entry.id), `${day} ${entry.departure} finst i rutetabellen`);
  }
});

test("avspeling i dag utan sanntid: turar som gjekk blir aldri «ikkje utført», avlyste blir det", () => {
  for (const day of REPLAY_DAYS) {
    const ran = ranJourneys(day);
    const legs = replayLegs(day, todayIso()).filter((item) => item.signal);
    const byId = new Map(replay.days[day].map((entry) => [entry.id, entry]));
    let cancelledChecks = 0;
    for (const now of replayTimes(legs)) {
      replayToday(day, now);
      for (const item of legs) {
        const id = journeyOf(item);
        const entry = byId.get(id);
        const verdict = signalVerdict(item, null, now);
        const where = `${day} ${item.departure} ${item.from}–${item.to} kl. ${clock(now)}`;
        if (entry?.status === "skipped") {
          const expected = now >= visibleFrom(entry) ? "skipped" : null;
          assert.equal(verdict, expected, where);
          if (expected) cancelledChecks += 1;
        } else {
          // Gått, bestilt (òg gamle «booked» utan avgangsbevis) og turar loggen ikkje har:
          // ingen bevis for at turen fall bort, så aldri «ikkje utført».
          assert.notEqual(verdict, "skipped", where);
          if (ran.has(id)) assert.notEqual(departureDetail(item, now).phase, "skipped", where);
        }
      }
    }
    const hasCancelled = replay.days[day].some((entry) => entry.status === "skipped");
    if (hasCancelled) assert.ok(cancelledChecks > 0, `${day} har avlyste turar som blir sjekka`);
  }
});

test("avspeling av tidlegare dagar: berre logga avlysing gir «ikkje utført»", () => {
  const target = shiftDay(todayIso(), -1);
  for (const day of REPLAY_DAYS) {
    const legs = replayLegs(day, target);
    const byId = new Map(replay.days[day].map((entry) => [entry.id, entry]));
    resetTestState();
    setTestState({
      date: target,
      routes: { lines: { 1136: { legs } } },
      signalLog: { days: { [target]: replay.days[day] } },
    });
    for (const item of legs.filter((entry) => entry.signal)) {
      const entry = byId.get(journeyOf(item));
      const where = `${day} ${item.departure} ${item.from}–${item.to}`;
      const detail = departureDetail(item, 12 * 60);
      if (entry?.status === "skipped") {
        assert.equal(signalVerdict(item, null, 12 * 60), "skipped", where);
        assert.equal(detail.seenSkip, true, where);
      } else {
        assert.equal(signalVerdict(item, null, 12 * 60), null, where);
        assert.notEqual(detail.phase, "skipped", where);
      }
    }
  }
});

test("avspeling 7. oktober utan posisjon frå Entur: tur utan logg er nøytral, avlyste er «ikkje utført»", () => {
  const day = "2026-10-07";
  const legs = replayLegs(day, todayIso());
  const find = (dep, from) => legs.find((item) => item.departure === dep && item.from === from);
  const out = find("11:10:00", "Valderøya");
  const back = find("12:10:00", "Store Kalvøy");
  const sabo = find("08:35:00", "Sæbø");
  const evening = find("19:00:00", "Valderøya");
  // 11:10 manglar i loggen, men returen 12:10 har faktisk avgang. Den gamle fristregelen
  // ville sagt «ikkje utført» om 11:10.
  for (const now of [11 * 60 + 30, 12 * 60, 12 * 60 + 30, 23 * 60]) {
    replayToday(day, now);
    assert.equal(signalVerdict(out, null, now), null, `11:10 kl. ${clock(now)}`);
    assert.equal(departureDetail(out, now).phase, "unknown", `11:10 kl. ${clock(now)}`);
    assert.notEqual(signalVerdict(back, null, now), "skipped", `12:10 kl. ${clock(now)}`);
  }
  replayToday(day, 8 * 60 + 5);
  assert.equal(signalVerdict(sabo, null, 8 * 60 + 5), null);
  replayToday(day, 8 * 60 + 10);
  assert.equal(signalVerdict(sabo, null, 8 * 60 + 10), "skipped");
  assert.equal(departureDetail(sabo, 8 * 60 + 10).seenSkip, true);
  replayToday(day, 18 * 60);
  assert.equal(signalVerdict(evening, null, 18 * 60), "skipped");
});

test("avspeling 8. oktober: forseinka signaltur blir ikkje «ikkje utført» medan ferja ligg ved kai", () => {
  // 06:45 Standal–Trandal gjekk 06:45:58 (loggen). Her ligg ferja i tillegg 12 minutt
  // ved kai, slik Reviewer skildra. Loggen har ikkje sett avgangen enno.
  const day = "2026-10-08";
  const target = todayIso();
  const legs = replayLegs(day, target);
  const out = legs.find((item) => item.departure === "06:45:00" && item.from === "Standal");
  const back = legs.find((item) => item.departure === "07:05:00" && item.from === "Trandal");
  const atQuay = {
    validUntil: "2099-01-01T00:00:00Z",
    journeyRef: journeyOf(out),
    originAimed: `${target}T06:45:00+02:00`,
    destination: "Trandal",
    atStop: true,
    stopName: "Standal",
    latitude: 62.26652,
    longitude: 6.42321,
    actualDeparture: "",
    delayMinutes: 12,
  };
  for (let now = 6 * 60 + 45; now <= 6 * 60 + 57; now += 1) {
    replayToday(day, 6 * 60, { live: atQuay });
    assert.equal(signalVerdict(out, atQuay, now), null, `06:45 kl. ${clock(now)}`);
    assert.equal(signalVerdict(back, atQuay, now), null, `07:05 kl. ${clock(now)}`);
    const status = currentStatus(legs, now);
    assert.doesNotMatch(status.text, /ikkje utført/, `status kl. ${clock(now)}`);
    assert.match(status.text, /ligg til kai på Standal/, `status kl. ${clock(now)}`);
  }
  const left = {
    ...atQuay,
    atStop: false,
    stopName: "Trandal",
    actualDeparture: `${target}T06:57:40+02:00`,
    latitude: 62.263,
    longitude: 6.46,
  };
  replayToday(day, 6 * 60, { live: left });
  assert.equal(signalVerdict(out, left, 6 * 60 + 58), "running");
  // Etter avgangen har loggen faktisk avgang. Då er turen aldri «ikkje utført», same kva sanntid seier.
  replayToday(day, 7 * 60 + 30, { live: atQuay });
  assert.notEqual(signalVerdict(out, atQuay, 7 * 60 + 30), "skipped");
  assert.notEqual(signalVerdict(back, atQuay, 7 * 60 + 30), "skipped");
});

test("avspeling i kveld 8. oktober: 20:00 og 20:20 gjekk og er aldri «ikkje utført» utan sanntid", () => {
  const day = "2026-10-08";
  const legs = replayLegs(day, todayIso());
  const regular = legs.find((item) => item.departure === "19:40:00" && item.from === "Trandal");
  const out = legs.find((item) => item.departure === "20:00:00" && item.from === "Standal");
  const back = legs.find((item) => item.departure === "20:20:00" && item.from === "Trandal");
  assert.ok(regular && !regular.signal, "19:40 Trandal–Standal er vanleg tur");
  assert.ok(out?.signal && back?.signal, "20:00 og 20:20 er signalturar");
  for (const now of [19 * 60 + 40, 20 * 60 + 10, 20 * 60 + 30, 21 * 60, 23 * 60 + 30]) {
    replayToday(day, now);
    for (const item of [regular, out, back]) {
      assert.notEqual(signalVerdict(item, null, now), "skipped", `${item.departure} kl. ${clock(now)}`);
      assert.notEqual(departureDetail(item, now).phase, "skipped", `${item.departure} kl. ${clock(now)}`);
    }
    assert.ok(runningLegsToday(legs, now).some((item) => item === back), `20:20 er med kl. ${clock(now)}`);
  }
});

function runningLegsToday(legs, now) {
  const status = currentStatus(legs, now);
  assert.doesNotMatch(status.text || "", /ikkje utført/);
  return legs.filter((item) => !item.signal || signalVerdict(item, null, now) !== "skipped");
}

// --- 8. oktober 20:20: avlyst hos Entur, men ferja gjekk tom heim til Standal -------------
// tests/fixtures/vm_2026-10-08_2030.json er det ekte VM-svaret (RecordedAtTime 20:30:47,
// ValidUntilTime 20:32:47). Journey Planner hadde 1136_129 avlyst og 1136_128 med faktisk
// avgang 20:00:03.
const vm2030 = JSON.parse(
  readFileSync(new URL("./fixtures/vm_2026-10-08_2030.json", import.meta.url), "utf8")
);
const BACK_2020 = "MOR:ServiceJourney:1136_129_9150000046366348";
const OUT_2000 = "MOR:ServiceJourney:1136_128_9150000047474268";

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
  };
}

function evening2030(live, extra = {}) {
  const day = "2026-10-08";
  const legs = replayLegs(day, todayIso());
  resetTestState();
  setTestState({
    routes: { lines: { 1136: { legs } } },
    signalLog: { days: { [todayIso()]: replay.days[day] } },
    cancelledJourneys: new Set([BACK_2020]),
    seenJourneys: new Set([BACK_2020, OUT_2000]),
    actualDepartures: new Map([[OUT_2000, `${todayIso()}T20:00:03+02:00`]]),
    live,
    ...extra,
  });
  const back = legs.find((item) => journeyOf(item) === BACK_2020);
  const out = legs.find((item) => journeyOf(item) === OUT_2000);
  return { legs, back, out };
}

const vmLive = parseVehicleMonitoring(vm2030);
const freshVm = { ...vmLive, validUntil: "2099-01-01T00:00:00Z" };
const staleVm = { ...vmLive, validUntil: "2000-01-01T00:00:00Z", recordedAt: "2000-01-01T00:00:00Z" };

test("VM-svaret 20:30 har faktisk ankomst på Standal for 20:20-turen", () => {
  assert.equal(vmLive.journeyRef, BACK_2020);
  assert.equal(vmLive.stopName, "Standal");
  assert.equal(vmLive.atStop, true);
  assert.equal(vmLive.actualArrival, "2026-10-08T20:30:45+02:00");
  const { back } = evening2030(freshVm);
  assert.equal(liveProvesSailed(freshVm, back, 20 * 60 + 30), true);
  assert.equal(liveProvesSailed(staleVm, back, 20 * 60 + 33), false);
});

test("20:20 avlyst men køyrd (ekte 8. oktober): «Gått» og Standal, òg etter at sanntid har gått ut", () => {
  const storage = fakeStorage();
  const previous = globalThis.localStorage;
  globalThis.localStorage = storage;
  try {
    const { legs, back, out } = evening2030(freshVm);
    const now = 20 * 60 + 30;
    assert.equal(rememberLiveSailed(freshVm, now), true);
    assert.deepEqual(JSON.parse(storage.data["fergeruter-sailed-v2"]), { [todayIso()]: [BACK_2020] });
    assert.notEqual(signalVerdict(back, freshVm, now), "skipped");
    assert.equal(signalSailed(back), true);
    assert.equal(departureDetail(back, now).phase, "sailed");
    const fresh = currentStatus(legs, now);
    assert.match(fresh.text, /Standal/);
    assert.doesNotMatch(fresh.text, /ikkje utført|Trandal/);

    // Sanntid har gått ut, avlysinga frå Entur står. Same økt.
    for (const later of [20 * 60 + 33, 21 * 60]) {
      setTestState({ live: staleVm });
      assert.equal(signalVerdict(back, staleVm, later), null, `kl. ${clock(later)}`);
      assert.equal(signalSailed(back), true);
      const detail = departureDetail(back, later);
      assert.equal(detail.phase, "sailed", `kl. ${clock(later)}`);
      assert.equal(detail.skipped, false);
      assert.equal(detail.booked, false);
      assert.match(currentStatus(legs, later).text, /Standal/, `kl. ${clock(later)}`);
      assert.doesNotMatch(currentStatus(legs, later).text, /Trandal/);
      // 20:00 var ikkje avlyst og har faktisk avgang: bestilt, ikkje «gått».
      assert.equal(departureDetail(out, later).phase, "booked");
    }
    assert.equal(currentStatus(legs, 21 * 60).short, "Ferja er ferdig for dagen på Standal");

    // Ny innlasting etter at VM-posten har gått ut: minnet ligg i localStorage.
    const reloaded = evening2030(staleVm);
    assert.equal(signalVerdict(reloaded.back, staleVm, 21 * 60), null);
    assert.equal(departureDetail(reloaded.back, 21 * 60).phase, "sailed");
    assert.equal(currentStatus(reloaded.legs, 21 * 60).short, "Ferja er ferdig for dagen på Standal");
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test("utan sanntid i det heile seier status framleis Standal når turen heim er avlyst", () => {
  const { legs, back } = evening2030(null);
  // Ingen bevis for at 20:20 gjekk: avlysinga frå Entur står. Men ferja ligg over natta på Standal.
  assert.equal(signalVerdict(back, null, 21 * 60), "skipped");
  assert.equal(currentStatus(legs, 20 * 60 + 17).text, "Ferja ligg til kai på Trandal");
  assert.match(currentStatus(legs, 20 * 60 + 25).text, /tilbake til Standal utan passasjerar/);
  assert.equal(currentStatus(legs, 21 * 60).short, "Ferja er ferdig for dagen på Standal");
});

test("hugsa turar gjeld berre dagen i dag og blir få", () => {
  const storage = fakeStorage({
    "fergeruter-sailed-v2": JSON.stringify({ "2026-10-07": ["MOR:ServiceJourney:old"] }),
  });
  assert.deepEqual([...readSailedJourneys(todayIso(), storage)], []);
  const many = Array.from({ length: 80 }, (_, i) => `MOR:ServiceJourney:x${i}`);
  writeSailedJourneys(todayIso(), new Set(many), storage);
  const saved = JSON.parse(storage.data["fergeruter-sailed-v2"]);
  assert.deepEqual(Object.keys(saved), [todayIso()]);
  assert.equal(saved[todayIso()].length, 60);
  assert.equal(readSailedJourneys("2026-10-07", storage).size, 0);
  const broken = fakeStorage({ "fergeruter-sailed-v2": "{ikkje json" });
  assert.equal(readSailedJourneys(todayIso(), broken).size, 0);
});

test("sanntid før rutetida gjer ikkje ein tur gått", () => {
  const { back } = evening2030(null);
  const early = { ...freshVm, atStop: false, actualArrival: "", stopName: "", latitude: 62.263, longitude: 6.46 };
  assert.equal(liveProvesSailed(early, back, 20 * 60 + 5), false);
  assert.equal(liveProvesSailed(early, back, 20 * 60 + 12), true);
});

test("ved endekaia før rutetida er ikkje bevis (Entur kan ha kopla ferja til neste tur)", () => {
  const { back } = evening2030(null);
  const before = { ...freshVm, actualArrival: "2026-10-08T20:10:00+02:00" };
  assert.equal(liveProvesSailed(before, back, 20 * 60 + 12), false);
  const atStopEarly = { ...freshVm, actualArrival: "" };
  assert.equal(liveProvesSailed(atStopEarly, back, 20 * 60 + 15), false);
  assert.equal(liveProvesSailed(atStopEarly, back, 20 * 60 + 31), true);
});
