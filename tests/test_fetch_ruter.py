#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "fetch_ruter.py"
# Fast kopi av data/ruter.json (henta 2026-10-02). Den ekte fila rullar datovindauget
# fram kvar dag, så testar med faste datoar må lese denne.
FIXTURE_RUTER = ROOT / "tests" / "fixtures" / "ruter.json"

spec = importlib.util.spec_from_file_location("fetch_ruter", SCRIPT)
mod = importlib.util.module_from_spec(spec)
sys.modules["fetch_ruter"] = mod
assert spec.loader is not None
spec.loader.exec_module(mod)


def point(quay: str, dep: str | None, arr: str | None, request_stop=False):
    return {
        "requestStop": request_stop,
        "quay": {"id": quay, "name": f"{quay} ferjekai"},
        "departure": {"time": dep} if dep else None,
        "arrival": {"time": arr} if arr else None,
    }


def journey(points: list[dict], dates: list[str], sid="sj-1", notices=None):
    return {
        "id": sid,
        "passingTimes": points,
        "activeDates": dates,
        "notices": [{"text": t} for t in (notices or [])],
    }


class SignalTests(unittest.TestCase):
    def test_one_hour_notice(self):
        signal = mod.parse_signal(
            [{"text": "Berre på signal min. 1 time før, tlf. 91 66 93 40"}]
        )
        self.assertEqual(signal["minutesBefore"], 60)
        self.assertEqual(signal["phone"], "91 66 93 40")

    def test_three_hour_notice(self):
        signal = mod.parse_signal([{"text": "Berre på signal min. 3 timar før"}])
        self.assertEqual(signal["minutesBefore"], 180)
        self.assertIsNone(signal["phone"])

    def test_minutes_notice(self):
        signal = mod.parse_signal([{"text": "Berre på signal min. 45 minutt før"}])
        self.assertEqual(signal["minutesBefore"], 45)

    def test_unrelated_notice_is_ignored(self):
        self.assertIsNone(mod.parse_signal([{"text": "God tur"}]))
        self.assertIsNone(mod.parse_signal([]))

    def test_signal_lands_on_every_leg_of_the_journey(self):
        j = journey(
            [
                point("Standal", "08:00:00", None),
                point("Trandal", "08:20:00", "08:15:00"),
                point("Sæbø", None, "08:45:00"),
            ],
            ["2026-08-25"],
            notices=["Berre på signal min. 1 time før, tlf. 91 66 93 40"],
        )
        legs = mod.legs_from_journey(j)
        self.assertEqual(len(legs), 2)
        for leg in legs:
            self.assertEqual(leg["signal"]["minutesBefore"], 60)

    def test_pdf_overlay_keeps_only_marked_from_cells(self):
        """Entur merkar heile turen; PDF 1) gjeld berre Sæbø 08:35 på kvardag."""
        j = journey(
            [
                point("Standal", "07:40:00", None),
                point("Trandal", "08:00:00", "07:55:00"),
                point("Sæbø", "08:35:00", "08:20:00"),
                point("Skår", None, "08:55:00"),
            ],
            ["2026-08-28"],
            notices=["Berre på signal min. 1 time før, tlf. 91 66 93 40"],
        )
        legs = mod.legs_from_journey(j)
        mod.apply_fram_pdf_signal("1136", legs)
        marked = {
            (leg["from"], leg["departure"][:5]): bool(leg.get("signal")) for leg in legs
        }
        self.assertEqual(
            marked,
            {
                ("Standal", "07:40"): False,
                ("Trandal", "08:00"): False,
                ("Sæbø", "08:35"): True,
            },
        )

    def test_pdf_overlay_marks_saturday_trandal_0800(self):
        j = journey(
            [
                point("Standal", "07:40:00", None),
                point("Trandal", "08:00:00", "07:55:00"),
                point("Sæbø", None, "08:20:00"),
            ],
            ["2026-08-29"],
            notices=["Berre på signal min. 1 time før, tlf. 91 66 93 40"],
        )
        legs = mod.legs_from_journey(j)
        mod.apply_fram_pdf_signal("1136", legs)
        standal = next(leg for leg in legs if leg["from"] == "Standal")
        trandal = next(leg for leg in legs if leg["from"] == "Trandal")
        self.assertIsNone(standal["signal"])
        self.assertEqual(trandal["signal"]["minutesBefore"], 60)

    def test_pdf_overlay_keeps_sunday_signal_on_holiday(self):
        j = journey(
            [point("Trandal", "10:20:00", None), point("Sæbø", None, "10:50:00")],
            ["2026-08-30", "2027-01-01"],
            notices=["Berre på signal min. 1 time før, tlf. 91 66 93 40"],
        )
        legs = mod.legs_from_journey(j)
        mod.apply_fram_pdf_signal("1136", legs)
        self.assertEqual(legs[0]["signal"]["minutesBefore"], 60)

    def test_1135_pdf_overlay_clears_entur_notice(self):
        j = journey(
            [point("Sæbø", "08:15:00", None), point("Lekneset", None, "08:30:00")],
            ["2026-08-28"],
            notices=["Berre på signal min. 1 time før, tlf. 91 66 93 40"],
        )
        legs = mod.legs_from_journey(j)
        self.assertIsNotNone(legs[0]["signal"])
        mod.apply_fram_pdf_signal("1135", legs)
        self.assertIsNone(legs[0]["signal"])

    def test_journey_without_notice_has_no_signal(self):
        j = journey(
            [point("Trandal", "07:05:00", None), point("Standal", None, "07:20:00")],
            ["2026-08-25"],
        )
        self.assertIsNone(mod.legs_from_journey(j)[0]["signal"])


class AreaTests(unittest.TestCase):
    def test_hjorundfjord_quays(self):
        self.assertTrue(mod.is_hjorundfjord("Trandal"))
        self.assertTrue(mod.is_hjorundfjord("Sæbø"))
        self.assertFalse(mod.is_hjorundfjord("Valderøya"))
        self.assertFalse(mod.is_hjorundfjord("Store Kalvøy"))

    def test_payload_exposes_quay_list(self):
        payload = mod.build_payload(
            {"1136": {"id": "x", "publicCode": "1136", "name": "n", "serviceJourneys": []}},
            fetched_at="2026-08-25T00:00:00+00:00",
        )
        self.assertIn("Trandal", payload["hjorundfjordQuays"])
        self.assertIn("Leknes", payload["hjorundfjordQuays"])


class QuayNameTests(unittest.TestCase):
    def test_strips_quay_suffixes(self):
        self.assertEqual(mod.quay_place("Trandal ferjekai"), "Trandal")
        self.assertEqual(mod.quay_place("Store Kalvøy kai"), "Store Kalvøy")
        self.assertEqual(mod.quay_place("Sæbø"), "Sæbø")

    def test_lekneset_becomes_leknes(self):
        self.assertEqual(mod.quay_place("Lekneset"), "Leknes")
        self.assertEqual(mod.quay_place("Lekneset ferjekai"), "Leknes")


class LegTests(unittest.TestCase):
    def test_two_stop_journey_gives_one_leg(self):
        j = journey(
            [
                point("Trandal", "07:05:00", None),
                point("Standal", None, "07:20:00"),
            ],
            ["2026-08-25"],
        )
        legs = mod.legs_from_journey(j)
        self.assertEqual(len(legs), 1)
        self.assertEqual(legs[0]["from"], "Trandal")
        self.assertEqual(legs[0]["to"], "Standal")
        self.assertEqual(legs[0]["departure"], "07:05:00")
        self.assertEqual(legs[0]["arrival"], "07:20:00")

    def test_multi_stop_journey_is_split_per_leg(self):
        j = journey(
            [
                point("Standal", "08:00:00", None),
                point("Trandal", "08:20:00", "08:15:00"),
                point("Sæbø", None, "08:45:00"),
            ],
            ["2026-08-25"],
        )
        legs = mod.legs_from_journey(j)
        self.assertEqual([(l["from"], l["to"]) for l in legs], [("Standal", "Trandal"), ("Trandal", "Sæbø")])
        self.assertEqual(legs[0]["arrival"], "08:15:00")
        self.assertEqual(legs[1]["departure"], "08:20:00")

    def test_request_stop_is_kept(self):
        j = journey(
            [
                point("Trandal", "07:05:00", None, request_stop=True),
                point("Standal", None, "07:20:00"),
            ],
            ["2026-08-25"],
        )
        self.assertTrue(mod.legs_from_journey(j)[0]["requestStop"])


class PayloadTests(unittest.TestCase):
    def test_legs_are_sorted_by_departure(self):
        line = {
            "id": "MOR:Line:1136",
            "publicCode": "1136",
            "name": "Standal-Trandal",
            "serviceJourneys": [
                journey(
                    [point("Sæbø", "09:20:00", None), point("Trandal", None, "09:45:00")],
                    ["2026-08-25"],
                    "b",
                ),
                journey(
                    [point("Standal", "06:45:00", None), point("Trandal", None, "07:00:00")],
                    ["2026-08-25"],
                    "a",
                ),
            ],
        }
        payload = mod.build_payload({"1136": line}, fetched_at="2026-08-25T00:00:00+00:00")
        self.assertEqual(
            [leg["departure"] for leg in payload["lines"]["1136"]["legs"]],
            ["06:45:00", "09:20:00"],
        )

    def test_write_skipped_when_timetable_unchanged(self):
        line = {
            "id": "MOR:Line:1136",
            "publicCode": "1136",
            "name": "Standal-Trandal",
            "serviceJourneys": [
                journey(
                    [point("Trandal", "09:45:00", None), point("Standal", None, "10:00:00")],
                    ["2026-08-25"],
                )
            ],
        }
        first = mod.build_payload({"1136": line}, fetched_at="2026-08-25T00:00:00+00:00")
        second = mod.build_payload({"1136": line}, fetched_at="2026-08-26T00:00:00+00:00")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ruter.json"
            self.assertTrue(mod.write_if_changed(first, path))
            self.assertFalse(mod.write_if_changed(second, path))
            stored = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(stored["fetchedAt"], "2026-08-25T00:00:00+00:00")


class FetchTests(unittest.TestCase):
    def test_main_writes_json(self):
        def graphql_for(line_id: str) -> dict:
            if line_id.endswith("1135"):
                return {
                    "data": {
                        "line": {
                            "id": line_id,
                            "publicCode": "1135",
                            "name": "Sæbø-Leknes",
                            "serviceJourneys": [
                                journey(
                                    [
                                        point("Sæbø", "08:15:00", None),
                                        point("Lekneset", None, "08:30:00"),
                                    ],
                                    ["2026-08-25"],
                                )
                            ],
                        }
                    }
                }
            return {
                "data": {
                    "line": {
                        "id": line_id,
                        "publicCode": "1136",
                        "name": "Standal-Trandal",
                        "serviceJourneys": [
                            journey(
                                [
                                    point("Standal", "07:40:00", None),
                                    point("Trandal", None, "07:55:00"),
                                ],
                                ["2026-08-25"],
                            )
                        ],
                    }
                }
            }

        class FakeResponse:
            def __init__(self, payload: dict):
                self._payload = payload

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return json.dumps(self._payload).encode("utf-8")

        def fake_urlopen(req, timeout=60):
            body = json.loads(req.data.decode("utf-8"))
            return FakeResponse(graphql_for(body["variables"]["id"]))

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "ruter.json"
            with patch.object(mod.urllib.request, "urlopen", side_effect=fake_urlopen):
                with patch.object(sys, "argv", ["fetch_ruter.py", str(out)]):
                    self.assertEqual(mod.main(), 0)
            data = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(len(data["lines"]["1136"]["legs"]), 1)
            self.assertEqual(data["lines"]["1136"]["legs"][0]["to"], "Trandal")
            self.assertEqual(data["lines"]["1135"]["legs"][0]["from"], "Sæbø")
            self.assertEqual(data["lines"]["1135"]["legs"][0]["to"], "Leknes")
            self.assertEqual(data["lines"]["1135"]["legs"][0]["departure"], "08:15:00")


# FRAM 1136 frå 17.08.26, Frå-kolonnar (bbox 29.08.26). Onsdag har eiga tabell.
FRAM_PDF_FROM_1136 = {
    "mtthf": {
        "Standal": "0645 0740 1310 1545 1845 2000",
        "Trandal": "0705 0800 0945 1425 1515 1625 1810 1940 2020",
        "Sæbø": "0835 0920 1450 1650 1745",
        "Skår": "0855 1710",
    },
    "wednesday": {
        "Standal": "0740 1440 1610",
        "Trandal": "0800 1500 1550 1630",
        "Sæbø": "0835 1525",
        "Valderøya": "1110 1900",
        "Store Kalvøy": "1210 1925",
    },
    "saturday": {
        "Standal": "0740 1605 1845 2000",
        "Trandal": "0800 0945 1625 1810 1940 2020",
        "Sæbø": "0835 0920 1650 1745",
        "Skår": "0855 1710",
        "Valderøya": "1215",
        "Store Kalvøy": "1315",
    },
    "sunday": {
        "Standal": "0900 1000 1530 1655 2000 2040",
        "Trandal": "0920 1020 1215 1550 1715 1900 2020 2100",
        "Sæbø": "1050 1150 1750 1835",
        "Skår": "1120 1815",
    },
}

# FRAM 1135. Sommar og haust har same kvardag; helg mister 10:00 og 11:15 frå 01.09.
FRAM_PDF_FROM_1135_SUMMER = {
    "weekday": {
        "Sæbø": "0600 0630 0715 0815 0915 1030 1145 1245 1345 1445 1545 1630 1700 1730 1830 2000 2100 2215",
        "Leknes": "0615 0645 0730 0830 0930 1045 1200 1300 1400 1500 1600 1645 1715 1745 1845 2015 2115 2230",
    },
    "saturday": {
        "Sæbø": "0630 0830 0900 1000 1030 1115 1145 1245 1345 1445 1545 1630 1730 1830 2030 2115 2215",
        "Leknes": "0645 0845 0915 1015 1045 1130 1200 1300 1400 1500 1600 1645 1745 1845 2045 2130 2230",
    },
    "sunday": {
        "Sæbø": "0730 0815 0900 1000 1030 1115 1145 1245 1345 1445 1545 1630 1730 1800 1830 2030 2115 2215",
        "Leknes": "0745 0830 0915 1015 1045 1130 1200 1300 1400 1500 1600 1645 1745 1815 1845 2045 2130 2230",
    },
}
FRAM_PDF_FROM_1135_AUTUMN = {
    "weekday": FRAM_PDF_FROM_1135_SUMMER["weekday"],
    "saturday": {
        "Sæbø": "0630 0830 0900 1030 1145 1245 1345 1445 1545 1630 1730 1830 2030 2115 2215",
        "Leknes": "0645 0845 0915 1045 1200 1300 1400 1500 1600 1645 1745 1845 2045 2130 2230",
    },
    "sunday": {
        "Sæbø": "0730 0815 0900 1030 1145 1245 1345 1445 1545 1630 1730 1800 1830 2030 2115 2215",
        "Leknes": "0745 0830 0915 1045 1200 1300 1400 1500 1600 1645 1745 1815 1845 2045 2130 2230",
    },
}


def _from_times(legs, iso):
    got = {}
    for leg in legs:
        if iso not in (leg.get("activeDates") or []):
            continue
        got.setdefault(leg["from"], set()).add(leg["departure"][:2] + leg["departure"][3:5])
    return got


class StoredTimetableTests(unittest.TestCase):
    def test_1135_saebo_0815_weekday_from_entur(self):
        data = json.loads(FIXTURE_RUTER.read_text(encoding="utf-8"))
        weekday = "2026-10-01"
        match = [
            leg
            for leg in data["lines"]["1135"]["legs"]
            if leg["from"] == "Sæbø"
            and leg["to"] == "Leknes"
            and leg["departure"] == "08:15:00"
            and weekday in (leg.get("activeDates") or [])
        ]
        self.assertTrue(match, "1135 skal ha Sæbø 08:15 mot Leknes på kvardag")
        self.assertTrue(match[0]["arrival"].startswith("08:2"))

    def test_1135_pdf_has_no_signal_and_entur_matches(self):
        """FRAM 1135-PDF (sommar 20.06.26 og haust 01.09.26) har inga fotnote 1)."""
        data = json.loads((ROOT / "data" / "ruter.json").read_text(encoding="utf-8"))
        self.assertTrue(all(leg.get("signal") is None for leg in data["lines"]["1135"]["legs"]))

    def test_1136_signal_matches_fram_pdf_footnote(self):
        """Berre 1)/3)-cellene i 1136-PDF-en skal vere merkte som signal."""
        data = json.loads(FIXTURE_RUTER.read_text(encoding="utf-8"))
        samples = {
            "mtthf": "2026-10-01",
            "wednesday": "2026-10-07",
            "saturday": "2026-10-03",
            "sunday": "2026-10-04",
        }
        for group, iso in samples.items():
            expected = {
                (quay, f"{hhmm[:2]}:{hhmm[2:]}:00"): hours
                for quay, times in mod.PDF_SIGNAL_1136[group].items()
                for hhmm, hours in times.items()
            }
            got = {}
            for leg in data["lines"]["1136"]["legs"]:
                if iso not in (leg.get("activeDates") or []):
                    continue
                key = (leg["from"], leg["departure"])
                if leg.get("signal"):
                    got[key] = 3 if leg["signal"]["minutesBefore"] == 180 else 1
            self.assertEqual(got, expected, group)

    def test_1136_from_times_match_fram_pdf(self):
        """Frå-kolonnane i FRAM 1136-PDF 17.08.26."""
        data = json.loads(FIXTURE_RUTER.read_text(encoding="utf-8"))
        samples = {
            "mtthf": "2026-10-01",
            "wednesday": "2026-10-07",
            "saturday": "2026-10-03",
            "sunday": "2026-10-04",
        }
        legs = data["lines"]["1136"]["legs"]
        for group, iso in samples.items():
            got = _from_times(legs, iso)
            expected = {
                quay: set(times.split()) for quay, times in FRAM_PDF_FROM_1136[group].items()
            }
            for quay, times in got.items():
                self.assertEqual(times, expected.get(quay, set()), f"{group} {quay}")
            for quay, times in expected.items():
                self.assertEqual(got.get(quay, set()), times, f"{group} {quay}")

    def test_1135_from_times_match_fram_pdf_seasons(self):
        """1135 haust frå 01.09. Entur sitt vindauge har ikkje sommaren lenger."""
        data = json.loads(FIXTURE_RUTER.read_text(encoding="utf-8"))
        legs = data["lines"]["1135"]["legs"]
        samples = [
            (FRAM_PDF_FROM_1135_AUTUMN["weekday"], "2026-10-01"),
            (FRAM_PDF_FROM_1135_AUTUMN["saturday"], "2026-10-03"),
            (FRAM_PDF_FROM_1135_AUTUMN["sunday"], "2026-10-04"),
        ]
        for expected, iso in samples:
            got = _from_times(legs, iso)
            for quay, times in expected.items():
                self.assertEqual(got.get(quay, set()), set(times.split()), f"{iso} {quay}")

    def test_active_dates_cover_the_coming_months(self):
        """Tabellen skal ikkje gå ut om nokre veker. Jobben hentar på nytt kvar dag."""
        data = json.loads((ROOT / "data" / "ruter.json").read_text(encoding="utf-8"))
        horizon = date.today() + timedelta(days=60)
        for code in ("1136", "1135"):
            dates = {
                iso
                for leg in data["lines"][code]["legs"]
                for iso in (leg.get("activeDates") or [])
            }
            self.assertTrue(dates, code)
            self.assertGreaterEqual(max(dates), horizon.isoformat(), code)


class Line1049Tests(unittest.TestCase):
    def test_line_ids_include_festoya_hundeidvik(self):
        self.assertEqual(mod.LINE_IDS["1049"], "MOR:Line:1049")

    def test_fixture_has_1049_without_signal_trips(self):
        line = json.loads(FIXTURE_RUTER.read_text(encoding="utf-8"))["lines"]["1049"]
        self.assertEqual(line["publicCode"], "1049")
        self.assertTrue(all(leg["signal"] is None for leg in line["legs"]))
        self.assertEqual({leg["from"] for leg in line["legs"]}, {"Festøya", "Hundeidvik"})

    def test_quay_names_lose_ferjekai_suffix(self):
        self.assertEqual(mod.quay_place("Hundeidvik ferjekai"), "Hundeidvik")
        self.assertEqual(mod.quay_place("Festøya ferjekai"), "Festøya")


if __name__ == "__main__":
    unittest.main()
