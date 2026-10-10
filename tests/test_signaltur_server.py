import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "signaltur_server.py"
spec = importlib.util.spec_from_file_location("signaltur_server", SCRIPT)
server = importlib.util.module_from_spec(spec)
sys.modules["signaltur_server"] = server
assert spec.loader is not None
spec.loader.exec_module(server)
logger = server.load_logger()

OSLO = ZoneInfo("Europe/Oslo")
ROUTES = json.loads((ROOT / "tests" / "fixtures" / "ruter.json").read_text(encoding="utf-8"))
KEY = "hemmeleg-nokkel-som-aldri-skal-synast-1234"
WORKER = "https://worker.example"
BASE = "https://pages.example/data/"
NOW = datetime(2026, 10, 8, 20, 30, tzinfo=OSLO)


def log_at(stamp, status="booked"):
    return {"keptDays": 7, "updatedAt": stamp, "days": {"2026-10-08": [{"id": "MOR:ServiceJourney:x", "status": status}]}}


HARNESSES = []


class Harness:
    """Byter ut nettverket: get(url) frå ei tabell, post(url, key, log) lagrar kallet."""

    def __init__(self, sources=None, status=204):
        self.sources = {BASE + "ruter.json": ROUTES, **(sources or {})}
        self.status = status
        self.posts = []
        self.state = tempfile.TemporaryDirectory()
        HARNESSES.append(self)

    def env(self, **extra):
        return {"FERGERUTER_SENDER_KEY": KEY, "FERGERUTER_SENDER_URL": WORKER, "FERGERUTER_DATA_BASE": BASE, "FERGERUTER_SIGNAL_STATE": self.state.name, **extra}

    def get(self, url, timeout=0):
        return self.sources.get(url)

    def post(self, url, key, log, timeout=0):
        self.posts.append((url, key, log))
        return self.status

    def run(self, check=None, env=None, now=NOW):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = server.run_once(env or self.env(), now=now, get=self.get, post=self.post, logger=logger, check=check)
        return code, out.getvalue()


def fake_check(routes, existing, moment):
    return {"keptDays": 7, "updatedAt": moment.isoformat(), "days": {"2026-10-08": [{"seen": existing.get("updatedAt")}]}}


class ServerJobTest(unittest.TestCase):
    def tearDown(self):
        while HARNESSES:
            HARNESSES.pop().state.cleanup()

    def test_sender_loggen_til_workeren_med_nokkelen_og_skriv_den_aldri_ut(self):
        h = Harness()
        code, out = h.run(fake_check)
        self.assertEqual(code, 0)
        [(url, key, log)] = h.posts
        self.assertEqual((url, key), (f"{WORKER}/v1/signalturar", KEY))
        self.assertEqual(log["updatedAt"], NOW.isoformat())
        self.assertNotIn(KEY, out)
        self.assertIn("Loggen er skriven", out)

    def test_manglande_nokkel_gjev_feil_utan_nettverk(self):
        h = Harness()
        code, out = h.run(fake_check, env=h.env(FERGERUTER_SENDER_KEY=" "))
        self.assertEqual(code, 1)
        self.assertEqual(h.posts, [])
        self.assertIn("manglar", out)

    def test_forrige_logg_er_den_nyaste_av_workeren_og_pages(self):
        old, new = log_at("2026-10-08T20:00:00+02:00"), log_at("2026-10-08T20:20:00+02:00")
        for sources in ({f"{WORKER}/v1/signalturar": old, BASE + "signalturar.json": new}, {f"{WORKER}/v1/signalturar": new, BASE + "signalturar.json": old}):
            h = Harness(sources)
            self.assertEqual(h.run(fake_check)[0], 0)
            self.assertEqual(h.posts[0][2]["days"]["2026-10-08"][0]["seen"], new["updatedAt"])

    def test_utan_noko_tidlegare_logg_startar_ei_tom(self):
        h = Harness()
        self.assertEqual(h.run(fake_check)[0], 0)
        self.assertIsNone(h.posts[0][2]["days"]["2026-10-08"][0]["seen"])

    def test_workeren_nede_men_pages_lever_gjev_tilstanden_frå_pages(self):
        h = Harness({BASE + "signalturar.json": log_at("2026-10-08T20:10:00+02:00")})
        self.assertEqual(h.run(fake_check)[0], 0)
        self.assertEqual(h.posts[0][2]["days"]["2026-10-08"][0]["seen"], "2026-10-08T20:10:00+02:00")

    def test_rutetabell_fra_pages_blir_lagra_og_brukt_naar_pages_svikar(self):
        h = Harness()
        seen = []
        h.run(lambda routes, existing, moment: seen.append(routes) or fake_check(routes, existing, moment))
        h.sources.pop(BASE + "ruter.json")
        code, out = h.run(lambda routes, existing, moment: seen.append(routes) or fake_check(routes, existing, moment))
        self.assertEqual(code, 0)
        self.assertEqual(seen[0], seen[1])
        self.assertIn("siste gode kopi", out)
        fresh = Harness()
        fresh.sources.pop(BASE + "ruter.json")
        self.assertEqual(fresh.run(fake_check)[0], 1, "ingen rutetabell, ingen cache")
        self.assertEqual(fresh.posts, [])

    def test_sjekken_feilar_gjev_ingen_ny_logg(self):
        h = Harness()

        def boom(*_args):
            raise RuntimeError("Entur nede")

        code, out = h.run(boom)
        self.assertEqual(code, 1)
        self.assertEqual(h.posts, [])
        self.assertIn("Entur nede", out)

    def test_svar_frå_workeren(self):
        for status, code in ((204, 0), (200, 0), (409, 0), (429, 0), (401, 1), (500, 1), (0, 1)):
            h = Harness(status=status)
            self.assertEqual(h.run(fake_check)[0], code, status)

    def test_sjekken_er_den_same_som_GitHub_jobben_bruker(self):
        """run_check er det main() i log_signalturar.py køyrer: same resultat som update_log med same grunnlag."""
        existing = log_at("2026-10-08T20:00:00+02:00")
        cancelled = (set(), set(), {})
        calls = []
        got = logger.run_check(
            ROUTES, existing, NOW,
            fetch_cancelled_fn=lambda moment, ids: calls.append(("cancelled", sorted(ids))) or cancelled,
            fetch_vm_fn=lambda routes, today, legs: calls.append(("vm", today)) or {},
        )
        expected = logger.update_log(existing, ROUTES, NOW, set(), set(), actual_departures={})
        self.assertEqual(got, expected)
        self.assertEqual(got["updatedAt"], NOW.isoformat())
        self.assertEqual([c[0] for c in calls], ["cancelled", "vm"])

    def test_nyaste_logg_ignorerer_ugyldige(self):
        good = log_at("2026-10-08T20:00:00+02:00")
        self.assertEqual(server.newest_log(logger, [None, {"error": "no data"}, good, "x"]), good)
        self.assertEqual(server.newest_log(logger, [None]), {})


if __name__ == "__main__":
    unittest.main()
