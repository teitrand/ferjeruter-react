import importlib.util
import json
import sys
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "log_signalturar.py"
spec = importlib.util.spec_from_file_location("log_signalturar", SCRIPT)
mod = importlib.util.module_from_spec(spec)
sys.modules["log_signalturar"] = mod
assert spec.loader is not None
spec.loader.exec_module(mod)

apply_observations = mod.apply_observations
journey_ids_from_payload = mod.journey_ids_from_payload
observe_signal_trips = mod.observe_signal_trips
prune_days = mod.prune_days
update_log = mod.update_log
log_is_late = mod.log_is_late

OSLO = ZoneInfo("Europe/Oslo")


def leg(journey, departure, minutes_before=60):
    hours, minutes, seconds = departure.split(":")
    arrival_minutes = int(hours) * 60 + int(minutes) + 15
    arrival = f"{arrival_minutes // 60:02d}:{arrival_minutes % 60:02d}:{seconds}"
    return {
        "id": f"{journey}#0",
        "from": "Standal",
        "to": "Trandal",
        "departure": departure,
        "arrival": arrival,
        "signal": {"minutesBefore": minutes_before},
        "activeDates": ["2026-10-01"],
    }


class SignalLogTests(unittest.TestCase):
    def test_frist_som_ikkje_er_ute_blir_ikkje_logga(self):
        trips = observe_signal_trips(
            [leg("MOR:ServiceJourney:1136_a", "13:00:00")],
            now_minutes=11 * 60,
            cancelled_ids=set(),
            seen_ids={"MOR:ServiceJourney:1136_a"},
        )
        self.assertEqual(trips, [])

    def test_avlyst_etter_frist_er_ikkje_utført_og_synleg_er_ikkje_bestilt(self):
        trips = observe_signal_trips(
            [
                leg("MOR:ServiceJourney:1136_a", "13:00:00"),
                leg("MOR:ServiceJourney:1136_b", "14:00:00"),
            ],
            now_minutes=13 * 60 + 30,
            cancelled_ids={"MOR:ServiceJourney:1136_a"},
            seen_ids={"MOR:ServiceJourney:1136_a", "MOR:ServiceJourney:1136_b"},
        )
        by_id = {trip["id"]: trip for trip in trips}
        self.assertEqual(by_id["MOR:ServiceJourney:1136_a"]["status"], "skipped")
        self.assertNotIn("MOR:ServiceJourney:1136_b", by_id)

    def test_avlyst_blir_ikkje_skriven_om_til_bestilt(self):
        merged = apply_observations(
            [{"id": "MOR:ServiceJourney:1136_a", "status": "skipped", "departure": "13:00:00"}],
            [
                {
                    "id": "MOR:ServiceJourney:1136_a",
                    "from": "Standal",
                    "to": "Trandal",
                    "departure": "13:00:00",
                    "status": "booked",
                }
            ],
        )
        self.assertEqual(merged[0]["status"], "skipped")

    def test_fyrste_observasjon_held_tidspunktet(self):
        first = apply_observations(
            [],
            [
                {
                    "id": "MOR:ServiceJourney:1136_a",
                    "from": "Standal",
                    "to": "Trandal",
                    "departure": "13:00:00",
                    "status": "booked",
                }
            ],
            "2026-10-02T06:50:00+02:00",
        )
        self.assertEqual(first[0]["observedAt"], "2026-10-02T06:50:00+02:00")
        again = apply_observations(
            first,
            [
                {
                    "id": "MOR:ServiceJourney:1136_a",
                    "from": "Standal",
                    "to": "Trandal",
                    "departure": "13:00:00",
                    "status": "skipped",
                }
            ],
            "2026-10-02T07:20:00+02:00",
        )
        self.assertEqual(again[0]["status"], "skipped")
        self.assertEqual(again[0]["observedAt"], "2026-10-02T06:50:00+02:00")
        self.assertEqual(again[0]["skippedAt"], "2026-10-02T07:20:00+02:00")

    def test_loggen_held_sju_dagar(self):
        days = {f"2026-09-{day:02d}": [] for day in range(20, 31)}
        days["2026-10-01"] = []
        kept = prune_days(days, datetime(2026, 10, 1, tzinfo=OSLO).date(), kept_days=7)
        self.assertIn("2026-09-25", kept)
        self.assertNotIn("2026-09-24", kept)
        self.assertIn("2026-10-01", kept)

    def test_update_log_skriv_dagen_og_klipper(self):
        routes = {"lines": {"1136": {"legs": [leg("MOR:ServiceJourney:1136_a", "13:00:00")]}}}
        existing = {"days": {"2026-09-01": [{"id": "MOR:ServiceJourney:old", "status": "booked"}]}}
        moment = datetime(2026, 10, 1, 13, 30, tzinfo=OSLO)
        payload = update_log(existing, routes, moment, {"MOR:ServiceJourney:1136_a"})
        self.assertEqual(payload["keptDays"], 7)
        self.assertEqual(payload["days"]["2026-10-01"][0]["status"], "skipped")
        self.assertNotIn("2026-09-01", payload["days"])

    def test_observasjon_etter_ankomst_blir_ikkje_gjetta_bestilt(self):
        late = observe_signal_trips(
            [leg("MOR:ServiceJourney:1136_a", "13:00:00")],
            now_minutes=14 * 60,
            cancelled_ids=set(),
            seen_ids={"MOR:ServiceJourney:1136_a"},
        )
        self.assertEqual(late, [])
        still_cancelled = observe_signal_trips(
            [leg("MOR:ServiceJourney:1136_a", "13:00:00")],
            now_minutes=14 * 60,
            cancelled_ids={"MOR:ServiceJourney:1136_a"},
            seen_ids={"MOR:ServiceJourney:1136_a"},
        )
        self.assertEqual(still_cancelled[0]["status"], "skipped")
        in_time = observe_signal_trips(
            [leg("MOR:ServiceJourney:1136_a", "13:00:00")],
            now_minutes=13 * 60,
            cancelled_ids=set(),
            seen_ids={"MOR:ServiceJourney:1136_a"},
        )
        self.assertEqual(in_time, [])
        departed = observe_signal_trips(
            [leg("MOR:ServiceJourney:1136_a", "13:00:00")],
            now_minutes=13 * 60 + 5,
            cancelled_ids=set(),
            seen_ids={"MOR:ServiceJourney:1136_a"},
            actual_departures={"MOR:ServiceJourney:1136_a": "2026-10-01T13:01:00+02:00"},
        )
        self.assertEqual(departed[0]["status"], "booked")
        self.assertEqual(departed[0]["evidence"], "departed")
        self.assertEqual(departed[0]["observedAt"], "2026-10-01T13:01:00+02:00")

    def test_tur_som_har_dette_ut_av_feeden_blir_ikkje_gjetta_bestilt(self):
        trips = observe_signal_trips(
            [leg("MOR:ServiceJourney:1136_a", "13:00:00")],
            now_minutes=20 * 60,
            cancelled_ids=set(),
            seen_ids=set(),
        )
        self.assertEqual(trips, [])

    def test_cancelled_ids_les_berre_avlyste(self):
        cancelled, seen = journey_ids_from_payload(
            {
                "data": {
                    "standal": {
                        "estimatedCalls": [
                            {
                                "cancellation": False,
                                "serviceJourney": {"id": "MOR:ServiceJourney:1136_open"},
                            },
                            {
                                "cancellation": True,
                                "serviceJourney": {"id": "MOR:ServiceJourney:1136_a#0"},
                            },
                        ]
                    }
                }
            }
        )
        self.assertEqual(cancelled, {"MOR:ServiceJourney:1136_a"})
        self.assertEqual(seen, {"MOR:ServiceJourney:1136_open", "MOR:ServiceJourney:1136_a"})

    def test_hol_fyller_turar_som_entur_enno_har(self):
        morning = leg("MOR:ServiceJourney:1136_a", "08:00:00")
        midday = leg("MOR:ServiceJourney:1136_b", "13:00:00")
        gone = leg("MOR:ServiceJourney:1136_c", "09:00:00")
        routes = {"lines": {"1136": {"legs": [morning, midday, gone]}}}
        moment = datetime(2026, 10, 1, 12, 30, tzinfo=OSLO)
        payload = update_log(
            {"days": {}},
            routes,
            moment,
            {"MOR:ServiceJourney:1136_a"},
            {"MOR:ServiceJourney:1136_a", "MOR:ServiceJourney:1136_b"},
        )
        by_id = {trip["id"]: trip for trip in payload["days"]["2026-10-01"]}
        self.assertEqual(by_id["MOR:ServiceJourney:1136_a"]["status"], "skipped")
        self.assertNotIn("MOR:ServiceJourney:1136_b", by_id)
        self.assertNotIn("MOR:ServiceJourney:1136_c", by_id)

    def _pair(self):
        out = leg("MOR:ServiceJourney:1136_out", "06:45:00")
        out["from"] = "Standal"
        out["to"] = "Trandal"
        out["arrival"] = "07:00:00"
        back = leg("MOR:ServiceJourney:1136_back", "07:05:00")
        back["from"] = "Trandal"
        back["to"] = "Standal"
        back["arrival"] = "07:20:00"
        return out, back

    def test_tomtur_ut_for_bestilt_retur_er_gått(self):
        out, back = self._pair()
        actual = {
            "MOR:ServiceJourney:1136_out": "2026-10-05T06:46:00+02:00",
            "MOR:ServiceJourney:1136_back": "2026-10-05T07:06:00+02:00",
        }
        seen = set(actual)
        after_both = observe_signal_trips(
            [out, back],
            now_minutes=7 * 60 + 37,
            cancelled_ids=set(),
            seen_ids=seen,
            actual_departures=actual,
        )
        by_id = {trip["id"]: trip for trip in after_both}
        self.assertEqual(by_id["MOR:ServiceJourney:1136_out"]["status"], "gått")
        self.assertEqual(
            by_id["MOR:ServiceJourney:1136_out"]["observedAt"],
            "2026-10-05T06:46:00+02:00",
        )
        self.assertEqual(by_id["MOR:ServiceJourney:1136_back"]["status"], "booked")
        while_return_runs = observe_signal_trips(
            [out, back],
            now_minutes=7 * 60 + 10,
            cancelled_ids=set(),
            seen_ids=seen,
            actual_departures=actual,
        )
        while_by_id = {trip["id"]: trip for trip in while_return_runs}
        self.assertEqual(while_by_id["MOR:ServiceJourney:1136_out"]["status"], "gått")
        self.assertEqual(while_by_id["MOR:ServiceJourney:1136_back"]["status"], "booked")

    def test_uttur_utan_avgangstid_er_ikkje_bestilt_sjølv_om_returen_ligg_i_feeden(self):
        out, back = self._pair()
        trips = observe_signal_trips(
            [out, back],
            now_minutes=6 * 60 + 50,
            cancelled_ids=set(),
            seen_ids={"MOR:ServiceJourney:1136_out", "MOR:ServiceJourney:1136_back"},
        )
        self.assertEqual(trips, [])

    def test_avlyst_retur_gjer_ikkje_uttur_med_avgangstid_til_gått(self):
        out, back = self._pair()
        trips = observe_signal_trips(
            [out, back],
            now_minutes=8 * 60,
            cancelled_ids={"MOR:ServiceJourney:1136_back"},
            seen_ids={"MOR:ServiceJourney:1136_out", "MOR:ServiceJourney:1136_back"},
            actual_departures={"MOR:ServiceJourney:1136_out": "2026-10-05T06:46:00+02:00"},
        )
        by_id = {trip["id"]: trip for trip in trips}
        self.assertEqual(by_id["MOR:ServiceJourney:1136_out"]["status"], "booked")
        self.assertEqual(by_id["MOR:ServiceJourney:1136_back"]["status"], "skipped")

    def test_avlyst_tomtur_som_likevel_segla_er_gått(self):
        out, back = self._pair()
        trips = observe_signal_trips(
            [out, back],
            now_minutes=7 * 60 + 37,
            cancelled_ids={"MOR:ServiceJourney:1136_out"},
            seen_ids={"MOR:ServiceJourney:1136_out", "MOR:ServiceJourney:1136_back"},
            actual_departures={
                "MOR:ServiceJourney:1136_out": "2026-10-05T06:46:00+02:00",
                "MOR:ServiceJourney:1136_back": "2026-10-05T07:06:00+02:00",
            },
        )
        by_id = {trip["id"]: trip for trip in trips}
        self.assertEqual(by_id["MOR:ServiceJourney:1136_out"]["status"], "gått")
        self.assertEqual(by_id["MOR:ServiceJourney:1136_back"]["status"], "booked")

    def test_gått_blir_ikkje_skriven_om_til_bestilt(self):
        merged = apply_observations(
            [
                {
                    "id": "MOR:ServiceJourney:1136_out",
                    "status": "gått",
                    "departure": "06:45:00",
                    "observedAt": "2026-10-05T06:46:00+02:00",
                }
            ],
            [
                {
                    "id": "MOR:ServiceJourney:1136_out",
                    "from": "Standal",
                    "to": "Trandal",
                    "departure": "06:45:00",
                    "status": "booked",
                }
            ],
            "2026-10-05T08:07:00+02:00",
        )
        self.assertEqual(merged[0]["status"], "gått")
        self.assertEqual(merged[0]["observedAt"], "2026-10-05T06:46:00+02:00")
        from_skip = apply_observations(
            [{"id": "MOR:ServiceJourney:1136_out", "status": "skipped", "departure": "06:45:00"}],
            [
                {
                    "id": "MOR:ServiceJourney:1136_out",
                    "from": "Standal",
                    "to": "Trandal",
                    "departure": "06:45:00",
                    "status": "gått",
                    "observedAt": "2026-10-05T06:46:00+02:00",
                }
            ],
        )
        self.assertEqual(from_skip[0]["status"], "gått")

    def test_gått_tur_blir_logga_når_entur_enno_har_faktisk_avgang(self):
        journey = "MOR:ServiceJourney:1136_a"
        routes = {"lines": {"1136": {"legs": [leg(journey, "08:00:00")]}}}
        moment = datetime(2026, 10, 1, 12, 30, tzinfo=OSLO)
        actual = "2026-10-01T08:02:00+02:00"
        payload = update_log(
            {"days": {}},
            routes,
            moment,
            set(),
            {journey},
            actual_departures={journey: actual},
        )
        trip = payload["days"]["2026-10-01"][0]
        self.assertEqual(trip["status"], "booked")
        self.assertEqual(trip["evidence"], "departed")
        self.assertEqual(trip["observedAt"], actual)

    def _afternoon_pair(self):
        out = leg("MOR:ServiceJourney:1136_122", "16:50:00")
        out["from"] = "Sæbø"
        out["to"] = "Skår"
        out["arrival"] = "17:05:00"
        back = leg("MOR:ServiceJourney:1136_119", "17:10:00")
        back["from"] = "Skår"
        back["to"] = "Sæbø"
        back["arrival"] = "17:25:00"
        return out, back

    def test_synleg_utan_avlysing_før_avgang_er_ikkje_bestilt(self):
        """16:50 og 17:10 vart logga bestilt før Entur rakk å setje cancellation."""
        out, back = self._afternoon_pair()
        trips = observe_signal_trips(
            [out, back],
            now_minutes=16 * 60 + 7,
            cancelled_ids=set(),
            seen_ids={"MOR:ServiceJourney:1136_122", "MOR:ServiceJourney:1136_119"},
        )
        self.assertEqual(trips, [])

    def test_ubekrefta_booked_blir_ikkje_ståande(self):
        out, back = self._afternoon_pair()
        routes = {"lines": {"1136": {"legs": [out, back]}}}
        stale = {
            "days": {
                "2026-10-01": [
                    {
                        "id": "MOR:ServiceJourney:1136_122",
                        "from": "Sæbø",
                        "to": "Skår",
                        "departure": "16:50:00",
                        "status": "booked",
                        "observedAt": "2026-10-01T16:07:00+02:00",
                    },
                    {
                        "id": "MOR:ServiceJourney:1136_119",
                        "from": "Skår",
                        "to": "Sæbø",
                        "departure": "17:10:00",
                        "status": "booked",
                        "observedAt": "2026-10-01T16:07:00+02:00",
                    },
                ]
            }
        }
        moment = datetime(2026, 10, 1, 16, 7, tzinfo=OSLO)
        payload = update_log(
            stale,
            routes,
            moment,
            set(),
            {"MOR:ServiceJourney:1136_122", "MOR:ServiceJourney:1136_119"},
        )
        self.assertEqual(payload["days"]["2026-10-01"], [])

    def test_sein_avlysing_skriv_over_tidleg_booked(self):
        out, _back = self._afternoon_pair()
        routes = {"lines": {"1136": {"legs": [out]}}}
        journey = "MOR:ServiceJourney:1136_122"
        stale = {
            "days": {
                "2026-10-01": [
                    {
                        "id": journey,
                        "from": "Sæbø",
                        "to": "Skår",
                        "departure": "16:50:00",
                        "status": "booked",
                        "evidence": "departed",
                        "observedAt": "2026-10-01T16:51:00+02:00",
                    }
                ]
            }
        }
        moment = datetime(2026, 10, 1, 17, 7, tzinfo=OSLO)
        payload = update_log(stale, routes, moment, {journey}, {journey})
        trip = payload["days"]["2026-10-01"][0]
        self.assertEqual(trip["status"], "skipped")
        self.assertNotEqual(trip.get("evidence"), "departed")

    def test_faktisk_avgang_er_bestilt_og_tom_uttur_er_gått(self):
        out, back = self._afternoon_pair()
        actual = {
            "MOR:ServiceJourney:1136_122": "2026-10-01T16:51:00+02:00",
            "MOR:ServiceJourney:1136_119": "2026-10-01T17:11:00+02:00",
        }
        while_return_open = observe_signal_trips(
            [out, back],
            now_minutes=17 * 60,
            cancelled_ids=set(),
            seen_ids=set(actual),
            actual_departures={"MOR:ServiceJourney:1136_122": actual["MOR:ServiceJourney:1136_122"]},
        )
        self.assertEqual(while_return_open, [])
        after_both = observe_signal_trips(
            [out, back],
            now_minutes=17 * 60 + 30,
            cancelled_ids=set(),
            seen_ids=set(actual),
            actual_departures=actual,
        )
        by_id = {trip["id"]: trip for trip in after_both}
        self.assertEqual(by_id["MOR:ServiceJourney:1136_122"]["status"], "gått")
        self.assertEqual(by_id["MOR:ServiceJourney:1136_119"]["status"], "booked")
        self.assertEqual(by_id["MOR:ServiceJourney:1136_119"]["evidence"], "departed")

    def test_stadfesta_avgang_blir_ståande_når_kallet_dett_ut(self):
        journey = "MOR:ServiceJourney:1136_a"
        routes = {"lines": {"1136": {"legs": [leg(journey, "13:00:00")]}}}
        existing = {
            "days": {
                "2026-10-01": [
                    {
                        "id": journey,
                        "from": "Standal",
                        "to": "Trandal",
                        "departure": "13:00:00",
                        "status": "booked",
                        "evidence": "departed",
                        "observedAt": "2026-10-01T13:01:00+02:00",
                    }
                ]
            }
        }
        moment = datetime(2026, 10, 1, 18, 0, tzinfo=OSLO)
        payload = update_log(existing, routes, moment, set(), set())
        trip = payload["days"]["2026-10-01"][0]
        self.assertEqual(trip["status"], "booked")
        self.assertEqual(trip["evidence"], "departed")

    def test_kall_frå_annan_dag_tel_ikkje(self):
        cancelled, seen = journey_ids_from_payload(
            {
                "data": {
                    "standal": {
                        "estimatedCalls": [
                            {
                                "cancellation": True,
                                "aimedDepartureTime": "2026-10-04T08:00:00+02:00",
                                "serviceJourney": {"id": "MOR:ServiceJourney:1136_old"},
                            },
                            {
                                "cancellation": False,
                                "aimedDepartureTime": "2026-10-05T13:00:00+02:00",
                                "actualDepartureTime": "2026-10-05T13:01:00+02:00",
                                "serviceJourney": {"id": "MOR:ServiceJourney:1136_today"},
                            },
                        ]
                    }
                }
            },
            "2026-10-05",
        )
        self.assertEqual(seen, {"MOR:ServiceJourney:1136_today"})
        self.assertEqual(cancelled, set())
        actual = mod.actual_departures_from_payload(
            {
                "data": {
                    "standal": {
                        "estimatedCalls": [
                            {
                                "aimedDepartureTime": "2026-10-05T13:00:00+02:00",
                                "actualDepartureTime": "2026-10-05T13:01:00+02:00",
                                "serviceJourney": {"id": "MOR:ServiceJourney:1136_today"},
                            }
                        ]
                    }
                }
            },
            "2026-10-05",
        )
        self.assertEqual(actual["MOR:ServiceJourney:1136_today"], "2026-10-05T13:01:00+02:00")

    def test_full_side_les_resten_av_dagen(self):
        moment = datetime(2026, 10, 1, 15, 0, tzinfo=OSLO)
        first = {
            "data": {
                "s0": {
                    "estimatedCalls": [
                        {
                            "cancellation": True,
                            "aimedDepartureTime": "2026-10-01T08:00:00+02:00",
                            "serviceJourney": {"id": "MOR:ServiceJourney:1136_a"},
                        }
                    ]
                }
            }
        }
        second = {
            "data": {
                "s0": {
                    "estimatedCalls": [
                        {
                            "cancellation": False,
                            "aimedDepartureTime": "2026-10-01T13:00:00+02:00",
                            "actualDepartureTime": "2026-10-01T13:04:00+02:00",
                            "serviceJourney": {"id": "MOR:ServiceJourney:1136_b"},
                        }
                    ]
                }
            }
        }
        starts = []

        def post_pages(start, stop_ids):
            starts.append(start)
            if len(starts) == 1:
                return first
            if len(starts) == 2:
                return second
            return {"data": {"s0": {"estimatedCalls": []}}}

        cancelled, seen, actual = mod.fetch_cancelled(
            moment,
            ["NSR:StopPlace:39713"],
            post=post_pages,
            page_size=1,
        )
        self.assertEqual(cancelled, {"MOR:ServiceJourney:1136_a"})
        self.assertIn("MOR:ServiceJourney:1136_b", seen)
        self.assertEqual(actual["MOR:ServiceJourney:1136_b"], "2026-10-01T13:04:00+02:00")
        self.assertGreaterEqual(len(starts), 2)

    def test_kort_side_blir_ikkje_følgd_av_ei_ny(self):
        calls = {"n": 0}

        def post(start, stop_ids):
            calls["n"] += 1
            return {"data": {"s0": {"estimatedCalls": []}}}

        mod.fetch_cancelled(
            datetime(2026, 10, 1, 12, 0, tzinfo=OSLO),
            ["NSR:StopPlace:39713"],
            post=post,
            page_size=40,
        )
        self.assertEqual(calls["n"], 1)


class SignalLogHeartbeatTests(unittest.TestCase):
    def test_fersk_logg_er_ikkje_for_sein(self):
        moment = datetime(2026, 10, 4, 10, 0, tzinfo=ZoneInfo("UTC"))
        self.assertFalse(log_is_late("2026-10-04T09:40:00Z", moment))

    def test_to_timar_gammal_logg_er_for_sein(self):
        moment = datetime(2026, 10, 4, 10, 0, tzinfo=ZoneInfo("UTC"))
        self.assertTrue(log_is_late("2026-10-04T08:00:00Z", moment))

    def test_natt_er_planlagt_pause(self):
        moment = datetime(2026, 10, 4, 2, 0, tzinfo=ZoneInfo("UTC"))
        self.assertFalse(log_is_late("2026-10-03T21:30:00Z", moment))

    def test_manglande_hjarteslag_er_for_seint_på_dagen(self):
        moment = datetime(2026, 10, 4, 10, 0, tzinfo=ZoneInfo("UTC"))
        self.assertTrue(log_is_late("", moment))
        self.assertTrue(log_is_late(None, moment))

    def test_morgon_reknar_ikkje_med_nattpausen(self):
        early = datetime(2026, 10, 4, 4, 30, tzinfo=ZoneInfo("UTC"))
        self.assertFalse(log_is_late("2026-10-03T21:30:00Z", early))
        late = datetime(2026, 10, 4, 5, 15, tzinfo=ZoneInfo("UTC"))
        self.assertTrue(log_is_late("2026-10-03T21:30:00Z", late))


class SailedDespiteCancelTests(unittest.TestCase):
    """8. oktober 20:20 Trandal–Standal: avlyst hos Entur, men ferja gjekk tom heim."""

    BACK = "MOR:ServiceJourney:1136_129_9150000046366348"
    OUT = "MOR:ServiceJourney:1136_128_9150000047474268"
    DAY = "2026-10-08"

    @classmethod
    def setUpClass(cls):
        cls.routes = json.loads((ROOT / "tests" / "fixtures" / "ruter.json").read_text(encoding="utf-8"))
        cls.vm = json.loads(
            (ROOT / "tests" / "fixtures" / "vm_2026-10-08_2030.json").read_text(encoding="utf-8")
        )
        cls.legs = mod.signal_legs(cls.routes, cls.DAY)

    def test_vm_viser_at_2020_kom_fram_til_standal(self):
        found = mod.vm_sailed_from_payload(self.vm, self.legs, self.DAY)
        self.assertEqual(found, {self.BACK: "2026-10-08T20:30:45+02:00"})

    def test_vm_frå_ein_annan_dag_tel_ikkje(self):
        self.assertEqual(mod.vm_sailed_from_payload(self.vm, self.legs, "2026-10-09"), {})

    def test_vm_ved_endekaia_før_rutetida_er_ikkje_bevis(self):
        payload = json.loads(json.dumps(self.vm))
        activity = payload["Siri"]["ServiceDelivery"]["VehicleMonitoringDelivery"][0]["VehicleActivity"][0]
        call = activity["MonitoredVehicleJourney"]["MonitoredCall"]
        call["ActualArrivalTime"] = "2026-10-08T20:10:00+02:00"
        self.assertEqual(mod.vm_sailed_from_payload(payload, self.legs, self.DAY), {})

    def test_vm_ved_startkaia_er_ikkje_bevis(self):
        payload = json.loads(json.dumps(self.vm))
        activity = payload["Siri"]["ServiceDelivery"]["VehicleMonitoringDelivery"][0]["VehicleActivity"][0]
        call = activity["MonitoredVehicleJourney"]["MonitoredCall"]
        call["StopPointName"] = [{"value": "Trandal ferjekai"}]
        call.pop("ActualArrivalTime")
        self.assertEqual(mod.vm_sailed_from_payload(payload, self.legs, self.DAY), {})

    def test_vm_ferje_ved_ei_anna_kai_enn_turen_er_ikkje_bevis(self):
        # 10. oktober: 1136 låg ved Standal medan Entur hadde kopla ferja til turen Valderøya → Store Kalvøy.
        payload = json.loads(json.dumps(self.vm))
        activity = payload["Siri"]["ServiceDelivery"]["VehicleMonitoringDelivery"][0]["VehicleActivity"][0]
        call = activity["MonitoredVehicleJourney"]["MonitoredCall"]
        call["StopPointName"] = [{"value": "Skår ferjekai"}]
        call["ActualDepartureTime"] = "2026-10-08T20:25:00+02:00"
        call["VehicleAtStop"] = True
        self.assertEqual(mod.vm_sailed_from_payload(payload, self.legs, self.DAY), {})

    def _observe(self, actual):
        trips = observe_signal_trips(
            self.legs,
            now_minutes=20 * 60 + 37,
            cancelled_ids={self.BACK},
            seen_ids={self.BACK, self.OUT},
            actual_departures=actual,
        )
        return {trip["id"]: trip for trip in trips}

    def test_utan_sanntid_blir_den_avlyste_turen_ikkje_utført(self):
        by_id = self._observe({self.OUT: "2026-10-08T20:00:03+02:00"})
        self.assertEqual(by_id[self.BACK]["status"], "skipped")
        self.assertEqual(by_id[self.OUT]["status"], "booked")

    def test_avlyst_tur_som_vm_viser_køyrd_er_gått_med_bevis(self):
        actual = {self.OUT: "2026-10-08T20:00:03+02:00"}
        actual.update(mod.vm_sailed_from_payload(self.vm, self.legs, self.DAY))
        by_id = self._observe(actual)
        self.assertEqual(by_id[self.BACK]["status"], "gått")
        self.assertEqual(by_id[self.BACK]["evidence"], "departed")
        self.assertEqual(by_id[self.BACK]["observedAt"], "2026-10-08T20:30:45+02:00")
        self.assertEqual(by_id[self.OUT]["status"], "booked")

    def test_seinare_gått_med_bevis_skriv_over_tidlegare_skipped(self):
        earlier = apply_observations(
            [],
            [self._observe({})[self.BACK]],
            "2026-10-08T20:37:45+02:00",
        )
        self.assertEqual(earlier[0]["status"], "skipped")
        actual = mod.vm_sailed_from_payload(self.vm, self.legs, self.DAY)
        merged = apply_observations(earlier, [self._observe(actual)[self.BACK]], "2026-10-08T21:07:45+02:00")
        self.assertEqual(merged[0]["status"], "gått")
        self.assertEqual(merged[0]["evidence"], "departed")
        self.assertEqual(merged[0]["observedAt"], "2026-10-08T20:30:45+02:00")
        self.assertNotIn("skippedAt", merged[0])
        # Eit nytt svar utan sanntid gjer ikkje gått om til skipped att.
        again = apply_observations(merged, [self._observe({})[self.BACK]], "2026-10-08T21:37:45+02:00")
        self.assertEqual(again[0]["status"], "gått")

    def test_vm_kall_berre_for_linjer_med_signalturar_og_feil_stoppar_ikkje_loggen(self):
        asked = []

        def get(line):
            asked.append(line)
            if line == "1136":
                return self.vm
            raise OSError("nett")

        found = mod.fetch_vm_sailed(self.routes, self.DAY, self.legs, get=get)
        self.assertEqual(asked, ["1136"])
        self.assertEqual(found, {self.BACK: "2026-10-08T20:30:45+02:00"})

        def broken(line):
            raise OSError("nett")

        self.assertEqual(mod.fetch_vm_sailed(self.routes, self.DAY, self.legs, get=broken), {})


if __name__ == "__main__":
    unittest.main()
