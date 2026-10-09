import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "commit_on_main.py"
spec = importlib.util.spec_from_file_location("commit_on_main", SCRIPT)
mod = importlib.util.module_from_spec(spec)
sys.modules["commit_on_main"] = mod
assert spec.loader is not None
spec.loader.exec_module(mod)


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


def write(cwd, name, text):
    path = Path(cwd) / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


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
        write(self.origin, "data/trafikkmeldinger.json", "{}\n")
        run_git(self.origin, "add", "data/trafikkmeldinger.json")
        run_git(self.origin, "commit", "-m", "init")
        run_git(root, "clone", str(self.origin), "worker")
        run_git(root, "clone", str(self.origin), "other")
        git_identity(self.worker)
        git_identity(self.other)

    def file_on_main(self, name):
        proc = run_git(self.origin, "show", f"main:{name}")
        return proc.stdout

    def test_push_landar(self):
        def refresh():
            write(self.worker, "data/trafikkmeldinger.json", '{"n": 1}\n')

        result = mod.publish(
            self.worker,
            ["data/trafikkmeldinger.json"],
            "data: oppdater",
            refresh=refresh,
            refspec="HEAD:main",
            sleep_fn=lambda _seconds: None,
        )
        self.assertEqual(result, "pushed")
        self.assertIn('"n": 1', self.file_on_main("data/trafikkmeldinger.json"))

    def test_ingen_endring(self):
        def refresh():
            write(self.worker, "data/trafikkmeldinger.json", "{}\n")

        before = run_git(self.origin, "rev-parse", "main").stdout.strip()
        result = mod.publish(
            self.worker,
            ["data/trafikkmeldinger.json"],
            "data: oppdater",
            refresh=refresh,
            refspec="HEAD:main",
            sleep_fn=lambda _seconds: None,
        )
        after = run_git(self.origin, "rev-parse", "main").stdout.strip()
        self.assertEqual(result, "unchanged")
        self.assertEqual(before, after)

    def test_rebase_når_anna_fil_landar_først(self):
        calls = {"n": 0}

        def refresh():
            calls["n"] += 1
            write(self.worker, "data/trafikkmeldinger.json", '{"n": 2}\n')
            if calls["n"] == 1:
                write(self.other, "data/signalturar.json", "{}\n")
                run_git(self.other, "add", "data/signalturar.json")
                run_git(self.other, "commit", "-m", "logg")
                run_git(self.other, "push", "origin", "HEAD:main")

        result = mod.publish(
            self.worker,
            ["data/trafikkmeldinger.json"],
            "data: oppdater",
            refresh=refresh,
            refspec="HEAD:main",
            sleep_fn=lambda _seconds: None,
        )
        self.assertEqual(result, "pushed")
        self.assertEqual(calls["n"], 1)
        self.assertIn('"n": 2', self.file_on_main("data/trafikkmeldinger.json"))
        self.assertIn("{", self.file_on_main("data/signalturar.json"))

    def test_kollisjon_blir_skriven_om(self):
        calls = {"n": 0}

        def refresh():
            calls["n"] += 1
            write(self.worker, "data/trafikkmeldinger.json", f'{{"v": {calls["n"]}}}\n')
            if calls["n"] == 1:
                write(self.other, "data/trafikkmeldinger.json", '{"v": "annan"}\n')
                run_git(self.other, "add", "data/trafikkmeldinger.json")
                run_git(self.other, "commit", "-m", "konkurrent")
                run_git(self.other, "push", "origin", "HEAD:main")

        result = mod.publish(
            self.worker,
            ["data/trafikkmeldinger.json"],
            "data: oppdater",
            refresh=refresh,
            refspec="HEAD:main",
            sleep_fn=lambda _seconds: None,
        )
        self.assertEqual(result, "pushed")
        self.assertGreaterEqual(calls["n"], 2)
        payload = json.loads(self.file_on_main("data/trafikkmeldinger.json"))
        self.assertEqual(payload["v"], calls["n"])
        self.assertNotIn("<<<", self.file_on_main("data/trafikkmeldinger.json"))

    def test_cli_push(self):
        write(self.worker, "data/merknad.txt", "hei\n")
        code = mod.main(
            [
                "--repo",
                str(self.worker),
                "--to",
                "main",
                "--message",
                "data: merknad",
                "data/merknad.txt",
            ]
        )
        self.assertEqual(code, 0)
        self.assertIn("hei", self.file_on_main("data/merknad.txt"))


class WorkflowWiringTests(unittest.TestCase):
    @unittest.skipUnless(
        (ROOT / ".github" / "workflows" / "log-signalturar.yml").exists(),
        "datajobbane ligg berre i det gamle fergeruter-repoet",
    )
    def test_datajobbar_brukar_felles_push(self):
        names = [
            "update-trafikkmeldinger.yml",
            "update-ruter.yml",
            "sync-dev-folder.yml",
        ]
        for name in names:
            text = (ROOT / ".github" / "workflows" / name).read_text(encoding="utf-8")
            self.assertIn("scripts/commit_on_main.py", text, name)
            self.assertNotIn("git push", text, name)
            self.assertIn("fetch-depth: 0", text, name)

        signaltur = (ROOT / ".github" / "workflows" / "log-signalturar.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("commit_on_main.py", signaltur)
        loop = (ROOT / "scripts" / "signaltur_loop.py").read_text(encoding="utf-8")
        self.assertIn("push_committed", loop)
        self.assertIn('refspec="HEAD:main"', loop)


if __name__ == "__main__":
    unittest.main()
