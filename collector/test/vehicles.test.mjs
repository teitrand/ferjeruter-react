import assert from "node:assert/strict";
import test from "node:test";
import { fromVehicleMonitoring, fromVehicleUpdate, quayAt, subscriptionQuery } from "../src/vehicles.js";

// Same form som ei ekte melding frå Entur (MOR, 9. oktober 2026), flytta til Trandal.
const update = {
  lastUpdated: "2026-10-09T09:18:52Z",
  expiration: "2026-10-09T09:20:52Z",
  vehicleId: "MOR:Vehicle:254_9999",
  originName: null,
  destinationName: "Sæbø Trandal Standal",
  delay: 60,
  bearing: 8,
  monitored: true,
  vehicleStatus: "IN_PROGRESS",
  location: { latitude: 62.2611, longitude: 6.5009 },
  line: { lineRef: "MOR:Line:1136", publicCode: "1136" },
  serviceJourney: { id: "MOR:ServiceJourney:1136_101_9150000046366323", date: "2026-10-09" },
  monitoredCall: { stopPointRef: "NSR:Quay:12345", vehicleAtStop: true },
  progressBetweenStops: null,
};

test("subscription per linje med buffer", () => {
  const q = subscriptionQuery("1136");
  assert.match(q, /lineRef: "MOR:Line:1136"/);
  assert.match(q, /bufferTime: 5000/);
  assert.match(q, /codespaceId: "MOR"/);
});

test("VehicleUpdate blir sanntid i same form som appen", () => {
  const live = fromVehicleUpdate(update, "1136", "2026-10-09T09:18:55Z");
  assert.equal(live.line, "1136");
  assert.equal(live.source, "stream");
  assert.equal(live.destination, "Sæbø");
  assert.equal(live.delayMinutes, 1);
  assert.equal(live.journeyRef, "MOR:ServiceJourney:1136_101_9150000046366323");
  assert.equal(live.atStop, true);
  assert.equal(live.stopName, "Trandal");
  assert.equal(live.validUntil, "2026-10-09T09:20:52Z");
  assert.equal(live.recordedAt, "2026-10-09T09:18:52Z");
  assert.equal(live.observedAt, "2026-10-09T09:18:55Z");
});

test("kai berre innanfor 250 m, og 0,0 er ingen posisjon", () => {
  assert.equal(quayAt(62.266216, 6.423177), "Standal");
  assert.equal(quayAt(62.24, 6.46), "");
  assert.equal(quayAt(0, 0), "");
  assert.equal(quayAt(null, null), "");
  assert.equal(fromVehicleUpdate(null, "1136"), null);
});

test("SIRI VM frå REST går gjennom parseVehicleMonitoring i core", () => {
  const data = {
    Siri: {
      ServiceDelivery: {
        VehicleMonitoringDelivery: [
          {
            VehicleActivity: [
              {
                RecordedAtTime: "2026-10-09T09:00:00+02:00",
                ValidUntilTime: "2026-10-09T09:05:00+02:00",
                MonitoredVehicleJourney: {
                  DestinationName: [{ value: "Skår" }],
                  Delay: "PT2M",
                  VehicleLocation: { Latitude: 62.2, Longitude: 6.5 },
                  FramedVehicleJourneyRef: { DatedVehicleJourneyRef: "MOR:ServiceJourney:1136_108_1" },
                  MonitoredCall: { VehicleAtStop: "false", StopPointName: [{ value: "Skår" }] },
                },
              },
            ],
          },
        ],
      },
    },
  };
  const live = fromVehicleMonitoring(data, "1136", "2026-10-09T07:00:05Z");
  assert.equal(live.source, "rest");
  assert.equal(live.destination, "Skår");
  assert.equal(live.delayMinutes, 2);
  assert.equal(live.atStop, false);
  assert.equal(live.recordedAt, "2026-10-09T09:00:00+02:00");
  assert.equal(fromVehicleMonitoring({ Siri: { ServiceDelivery: { VehicleMonitoringDelivery: [{}] } } }, "1136"), null);
});
