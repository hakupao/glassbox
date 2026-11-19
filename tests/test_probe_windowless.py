"""Probe under pythonw.exe (no console): sys.stdout/stderr are None, output must go to probe.log."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SIM = """
import sys
sys.stdout = None; sys.stderr = None                    # what pythonw.exe gives a script
sys.path.insert(0, {root!r})
from probe.__main__ import windowless_log
p = windowless_log(home={home!r})
print("hello stdout")
print("hello stderr", file=sys.stderr)
raise SystemExit(0 if p else 3)
"""


class WindowlessTest(unittest.TestCase):
    def run_sim(self, home):
        return subprocess.run([sys.executable, "-I", "-c", SIM.format(root=str(ROOT), home=home)],
                              capture_output=True, text=True)

    def test_output_goes_to_probe_log_without_a_console(self):
        with tempfile.TemporaryDirectory() as home:
            r = self.run_sim(home)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual((r.stdout, r.stderr), ("", ""))
            log = (Path(home) / ".glassbox" / "probe.log").read_text(encoding="utf-8")
            self.assertIn("(no console)", log)
            self.assertIn("hello stdout", log)
            self.assertIn("hello stderr", log)

    def test_rotates_a_large_log(self):
        with tempfile.TemporaryDirectory() as home:
            d = Path(home) / ".glassbox"
            d.mkdir()
            (d / "probe.log").write_text("x" * 1_100_000, encoding="utf-8")
            self.assertEqual(self.run_sim(home).returncode, 0)
            self.assertTrue((d / "probe.log.1").exists())
            self.assertLess((d / "probe.log").stat().st_size, 10_000)

    def test_a_rotation_that_fails_keeps_logging(self):
        sim = SIM.replace("from probe.__main__ import windowless_log",
                          "from pathlib import Path\n"
                          "def boom(self, target): raise PermissionError('WinError 32: in use')\n"
                          "Path.replace = boom\n"
                          "from probe.__main__ import windowless_log")
        with tempfile.TemporaryDirectory() as home:
            d = Path(home) / ".glassbox"
            d.mkdir()
            (d / "probe.log").write_text("x" * 1_100_000, encoding="utf-8")
            r = subprocess.run([sys.executable, "-I", "-c", sim.format(root=str(ROOT), home=home)],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("hello stderr", (d / "probe.log").read_text(encoding="utf-8")[-200:])

    def test_child_processes_get_no_window_and_no_stdin(self):
        from unittest import mock
        from probe import local, projects
        seen = []
        def fake_run(*a, **k):
            seen.append(k)
            return mock.Mock(returncode=0, stdout="")
        with mock.patch("subprocess.run", fake_run):
            projects._git(["status"], ".")
            local._run(["git", "--version"])
        self.assertEqual(len(seen), 2)
        for k in seen:
            self.assertIs(k["stdin"], subprocess.DEVNULL)
            self.assertEqual(k["creationflags"], getattr(subprocess, "CREATE_NO_WINDOW", 0))
            # git prints paths in UTF-8; the locale codec (cp932 on a Japanese Windows) cannot decode them
            self.assertEqual(k["encoding"], "utf-8")
            self.assertEqual(k["errors"], "replace")

    def test_console_runs_are_unchanged(self):
        from probe.__main__ import windowless_log
        with tempfile.TemporaryDirectory() as home:
            self.assertIsNone(windowless_log(home=home))
            self.assertFalse(os.path.exists(Path(home) / ".glassbox" / "probe.log"))


if __name__ == "__main__":
    unittest.main()
