"""probe push --every: the resident loop used under launchd KeepAlive (runbook install-probe.md §4)."""
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from probe import __main__ as cli


class Stop(Exception):
    pass


def fake_sleep(limit):
    calls = []

    def sleep(s):
        calls.append(s)
        if len(calls) >= limit:
            raise Stop
    return sleep, calls


class PushEveryTest(unittest.TestCase):
    def test_each_cycle_runs_a_fresh_push_then_sleeps(self):
        sleep, slept = fake_sleep(2)
        run = mock.Mock(return_value=mock.Mock(returncode=0))
        with self.assertRaises(Stop):
            cli.push_every(["push", "--days", "3"], 900, run=run, sleep=sleep)
        self.assertEqual(slept, [900, 900])
        self.assertEqual(run.call_count, 2)
        cmd = run.call_args.args[0]
        self.assertEqual(cmd, [sys.executable, "-m", "probe", "push", "--days", "3"])
        self.assertEqual(run.call_args.kwargs["cwd"], Path(cli.__file__).resolve().parents[1])

    def test_failed_or_unstartable_push_still_waits_the_full_interval(self):
        sleep, slept = fake_sleep(3)
        run = mock.Mock(side_effect=[mock.Mock(returncode=1), OSError("gone"), mock.Mock(returncode=0)])
        with self.assertRaises(Stop), mock.patch("sys.stderr"):
            cli.push_every(["push"], 900, run=run, sleep=sleep)
        self.assertEqual(slept, [900, 900, 900])

    def test_a_hung_push_is_stopped_after_one_interval_and_the_loop_goes_on(self):
        import subprocess
        sleep, slept = fake_sleep(2)
        run = mock.Mock(side_effect=[subprocess.TimeoutExpired("probe", 900), mock.Mock(returncode=0)])
        with self.assertRaises(Stop), mock.patch("sys.stderr") as err:
            cli.push_every(["push"], 900, run=run, sleep=sleep)
        self.assertEqual(slept, [900, 900])
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args.kwargs["timeout"], 900)
        self.assertIn("longer than 900 s", "".join(c.args[0] for c in err.write.call_args_list))

    def test_main_builds_the_child_command_without_the_loop_flag(self):
        with mock.patch.object(cli, "push_every") as pe:
            cli.main(["--config", "cfg.toml", "push", "--days", "5", "--every", "900"])
        argv, seconds = pe.call_args.args
        self.assertEqual(seconds, 900)
        self.assertEqual(argv, ["--config", str(Path("cfg.toml").resolve()), "push", "--days", "5"])
        self.assertNotIn("--every", argv)

    def test_main_refuses_a_short_interval_and_a_repeated_rebaseline(self):
        for extra in (["--every", "10"], ["--every", "900", "--rebaseline"]):
            with mock.patch.object(cli, "push_every") as pe, mock.patch("sys.stderr"), self.assertRaises(SystemExit):
                cli.main(["push", *extra])
            pe.assert_not_called()


if __name__ == "__main__":
    unittest.main()
