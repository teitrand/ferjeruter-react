import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "signaltur_loop.py"
spec = importlib.util.spec_from_file_location("signaltur_loop", SCRIPT)
mod = importlib.util.module_from_spec(spec)
sys.modules["signaltur_loop"] = mod
assert spec.loader is not None
spec.loader.exec_module(mod)

UTC = timezone.utc


def at(*parts):
    return datetime(*parts, tzinfo=UTC)


def run_git(cwd, *args, check=True):
    proc = subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=False,
        text=True,
        capture_output=True,
    )
    if check and proc.returncode != 0:
        raise AssertionError((proc.stderr or proc.stdout or "").strip())
    return proc


def git_identity(cwd):
    run_git(cwd, "config", "user.email", "test@example.com")
    run_git(cwd, "config", "user.name", "Test")
    run_git(cwd, "config", "commit.gpgsign", "false")


def write_log(cwd, updated):
    path = Path(cwd) / "data" / "signalturar.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"updatedAt": updated}) + "\n", encoding="utf-8")


class FreshnessTests(unittest.TestCase):
    def test_ti_minutt_er_fersk(self):
        previous = "2026-10-05T09:50:00Z"
        self.assertTrue(mod.log_is_fresh(previous, at(2026, 10, 5, 10, 0)))

    def test_tjue_minutt_er_ikkje_fersk(self):
        previous = "2026-10-05T09:40:00Z"
        self.assertFalse(mod.log_is_fresh(previous, at(2026, 10, 5, 10, 0)))

    def test_uleseleg_tid_er_ikkje_fersk(self):
        self.assertFalse(mod.log_is_fresh("", at(2026, 10, 5, 10, 0)))
        self.assertFalse(mod.log_is_fresh("ikkje", at(2026, 10, 5, 10, 0)))


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.origin = root / "origin"
        self.worker = root / "worker"
        self.other = root / "other"
        self.origin.mkdir()
        run_git(self.origin, "init", "-b", "main")
        git_identity(self.origin)
        run_git(self.origin, "config", "receive.denyCurrentBranch", "ignore")
        write_log(self.origin, "2026-10-05T09:50:00Z")
        run_git(self.origin, "add", "data/signalturar.json")
        run_git(self.origin, "commit", "-m", "init")
        run_git(root, "clone", str(self.origin), "worker")
        run_git(root, "clone", str(self.origin), "other")
        git_identity(self.worker)
        git_identity(self.other)
        run_git(self.worker, "checkout", "--detach")

    def published(self):
        proc = run_git(self.origin, "show", "main:data/signalturar.json")
        return json.loads(proc.stdout)

    def test_push_landar_på_main(self):
        def run_logger():
            write_log(self.worker, "2026-10-05T10:00:00Z")
            return None

        result, late = mod.publish_log(
            self.worker,
            run_logger,
            now=at(2026, 10, 5, 10, 0),
            sleep_fn=lambda _seconds: None,
        )
        self.assertEqual(result, "pushed")
        self.assertFalse(late)
        self.assertEqual(self.published()["updatedAt"], "2026-10-05T10:00:00Z")

    def test_sein_logg_blir_likevel_pusha(self):
        def run_logger():
            write_log(self.worker, "2026-10-05T12:00:00Z")
            return None

        result, late = mod.publish_log(
            self.worker,
            run_logger,
            now=at(2026, 10, 5, 12, 0),
            sleep_fn=lambda _seconds: None,
        )
        self.assertEqual(result, "pushed")
        self.assertTrue(late)
        self.assertEqual(self.published()["updatedAt"], "2026-10-05T12:00:00Z")

    def test_rebase_når_main_har_flytta_seg(self):
        calls = {"n": 0}

        def run_logger():
            calls["n"] += 1
            write_log(self.worker, "2026-10-05T10:30:00Z")
            if calls["n"] == 1:
                note = self.other / "data" / "merknad.txt"
                note.write_text("frå den andre jobben\n", encoding="utf-8")
                run_git(self.other, "add", "data/merknad.txt")
                run_git(self.other, "commit", "-m", "anna fil")
                run_git(self.other, "push", "origin", "HEAD:main")
            return None

        result, _late = mod.publish_log(
            self.worker,
            run_logger,
            now=at(2026, 10, 5, 10, 30),
            sleep_fn=lambda _seconds: None,
        )
        self.assertEqual(result, "pushed")
        self.assertEqual(self.published()["updatedAt"], "2026-10-05T10:30:00Z")
        note_on_main = run_git(self.origin, "show", "main:data/merknad.txt")
        self.assertIn("andre jobben", note_on_main.stdout)

    def test_kollisjon_blir_skriven_om(self):
        calls = {"n": 0}

        def run_logger():
            calls["n"] += 1
            write_log(self.worker, f"v{calls['n']}")
            if calls["n"] == 1:
                write_log(self.other, "frå den andre løkka")
                run_git(self.other, "add", "data/signalturar.json")
                run_git(self.other, "commit", "-m", "konkurrent")
                run_git(self.other, "push", "origin", "HEAD:main")
            return None

        result, _late = mod.publish_log(
            self.worker,
            run_logger,
            now=at(2026, 10, 5, 11, 0),
            sleep_fn=lambda _seconds: None,
        )
        self.assertEqual(result, "pushed")
        self.assertGreaterEqual(calls["n"], 2)
        self.assertEqual(self.published()["updatedAt"], "v2")
        self.assertNotIn("<<<", run_git(self.origin, "show", "main:data/signalturar.json").stdout)

    def test_logger_som_feilar_commit_ikkje(self):
        class Failed:
            returncode = 1

        def run_logger():
            write_log(self.worker, "skal ikkje inn")
            return Failed()

        before = run_git(self.origin, "rev-parse", "main").stdout.strip()
        result, _late = mod.publish_log(
            self.worker,
            run_logger,
            now=at(2026, 10, 5, 10, 0),
            sleep_fn=lambda _seconds: None,
        )
        self.assertEqual(result, "logger-failed")
        after = run_git(self.origin, "rev-parse", "main").stdout.strip()
        self.assertEqual(before, after)

    def test_fersk_logg_blir_hoppa_over(self):
        def run_logger():
            write_log(self.worker, "skal ikkje inn")
            return None

        before = run_git(self.origin, "rev-parse", "main").stdout.strip()
        result, late = mod.publish_log(
            self.worker,
            run_logger,
            now=at(2026, 10, 5, 10, 0),
            sleep_fn=lambda _seconds: None,
            skip_if_fresh=True,
        )
        self.assertEqual(result, "fresh")
        self.assertFalse(late)
        after = run_git(self.origin, "rev-parse", "main").stdout.strip()
        self.assertEqual(before, after)
        self.assertEqual(self.published()["updatedAt"], "2026-10-05T09:50:00Z")

    def test_gammal_logg_blir_pusha_med_hopp(self):
        def run_logger():
            write_log(self.worker, "2026-10-05T12:00:00Z")
            return None

        result, late = mod.publish_log(
            self.worker,
            run_logger,
            now=at(2026, 10, 5, 12, 0),
            sleep_fn=lambda _seconds: None,
            skip_if_fresh=True,
        )
        self.assertEqual(result, "pushed")
        self.assertTrue(late)
        self.assertEqual(self.published()["updatedAt"], "2026-10-05T12:00:00Z")

    def test_force_skriv_fersk_logg(self):
        def run_logger():
            write_log(self.worker, "2026-10-05T10:05:00Z")
            return None

        result, late = mod.publish_log(
            self.worker,
            run_logger,
            now=at(2026, 10, 5, 10, 0),
            sleep_fn=lambda _seconds: None,
            skip_if_fresh=False,
        )
        self.assertEqual(result, "pushed")
        self.assertFalse(late)
        self.assertEqual(self.published()["updatedAt"], "2026-10-05T10:05:00Z")


class WorkflowContractTests(unittest.TestCase):
    @unittest.skipUnless(
        (ROOT / ".github" / "workflows" / "log-signalturar.yml").exists(),
        "datajobbane ligg berre i det gamle fergeruter-repoet",
    )
    def test_worker_er_klokka_og_github_cron_er_reserve(self):
        text = (ROOT / ".github" / "workflows" / "log-signalturar.yml").read_text(encoding="utf-8")
        script = SCRIPT.read_text(encoding="utf-8")
        wrangler = (ROOT / "cloudflare" / "signaltur-cron" / "wrangler.toml").read_text(
            encoding="utf-8"
        )
        worker = (ROOT / "cloudflare" / "signaltur-cron" / "src" / "index.js").read_text(
            encoding="utf-8"
        )
        self.assertIn('cron: "7,37 4-21 * * *"', text)
        self.assertNotIn('cron: "7 22 * * *"', text)
        self.assertIn('crons = ["7,37 4-21 * * *"]', wrangler)
        self.assertNotIn("7 22", wrangler)
        self.assertNotIn("*/30 4-21", text)
        self.assertNotIn("4-22", text)
        self.assertNotIn("4-22", wrangler)
        self.assertIn("workflow_dispatch:", text)
        self.assertIn("concurrency:", text)
        self.assertIn("group: log-signalturar", text)
        self.assertIn("cancel-in-progress: false", text)
        self.assertIn("contents: write", text)
        self.assertNotIn("actions: write", text)
        self.assertNotIn("timeout-minutes: 360", text)
        self.assertIn("scripts/signaltur_loop.py", text)
        self.assertNotIn("--require-recent", text)
        self.assertIn("refs/heads/main", text)
        self.assertIn("force:", text)
        self.assertIn("HEAD:main", script)
        self.assertIn("commit_on_main", script)
        self.assertNotIn("handoff", script)
        self.assertNotIn("workflow run", script)
        self.assertIn('ref: "main"', worker)
        self.assertIn("/repos/teitrand/fergeruter/actions/workflows/log-signalturar.yml/dispatches", worker)
        self.assertIn("/cancel", worker)
        self.assertIn("/rerun", worker)
        self.assertIn("RUNNER_GIVE_UP_MS", worker)
        self.assertIn("GITHUB_TOKEN", worker)


if __name__ == "__main__":
    unittest.main()
