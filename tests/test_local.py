"""Local facts: commit-title scrubbing and git activity on a throwaway repo (fabricated)."""
import subprocess
import tempfile
import unittest
from pathlib import Path

from probe import local, state


def git(repo, *args, email="me@example.com"):
    subprocess.run(["git", "-C", str(repo), "-c", f"user.email={email}", "-c", "user.name=t", *args],
                   check=True, capture_output=True)


class LocalTest(unittest.TestCase):
    def test_scrub_paths(self):
        mac, linux = "/" + "Users/a/b.js", "/" + "home/x/y"      # built at runtime: no path literals in the repo
        self.assertEqual(local.scrub(f"move {mac} and {linux}"), "move <path> and <path>")
        self.assertEqual(local.scrub("fix: plain title"), "fix: plain title")

    def test_git_activity_filters_author_and_marks_unpushed(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "work"
            repo = root / "demo"
            repo.mkdir(parents=True)
            git(repo, "init", "-q", "-b", "main")
            (repo / "a").write_text("1")
            git(repo, "add", "a")
            git(repo, "commit", "-qm", "feat: mine")
            (repo / "b").write_text("2")
            git(repo, "add", "b")
            git(repo, "commit", "-qm", "feat: someone else", email="other@example.com")
            conn = state.connect(Path(d) / "s.sqlite")
            cfg = {"machine": "A", "git_roots": [str(root)], "author_emails": ["ME@example.com"], "git_days": 60}
            out, used = local.git_activity(conn, cfg)
            self.assertEqual(len(out), 1)
            commits = out[0]["commits"]
            self.assertEqual([c["title"] for c in commits], ["feat: mine"])
            self.assertFalse(commits[0]["pushed"])
            self.assertFalse(out[0]["remote"])
            self.assertIn(out[0]["project"], used)
            self.assertNotIn(d, repr(out) + repr(used))      # no local paths in the report
            conn.close()


    def test_file_counts_one_call_per_repo_merge_zero_no_names(self):
        """S17 R09: nFiles per commit from one extra git call per repository; a merge counts 0; file
        names never appear in the report; if the count call fails, commits still go out without it."""
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "work"
            repo = root / "demo"
            repo.mkdir(parents=True)
            git(repo, "init", "-q", "-b", "main")
            for n in ("zeta-one.txt", "zeta-two.txt", "zeta three.txt"):
                (repo / n).write_text(n)
            git(repo, "add", ".")
            git(repo, "commit", "-qm", "feat: three files")
            git(repo, "checkout", "-qb", "side")
            (repo / "zeta-side.txt").write_text("s")
            git(repo, "add", ".")
            git(repo, "commit", "-qm", "feat: side")
            git(repo, "checkout", "-q", "main")
            (repo / "zeta-one.txt").write_text("changed")
            git(repo, "commit", "-qam", "fix: one file")
            git(repo, "merge", "-q", "--no-ff", "-m", "merge: side", "side")
            conn = state.connect(Path(d) / "s.sqlite")
            cfg = {"machine": "A", "git_roots": [str(root)], "author_emails": ["me@example.com"], "git_days": 60}
            calls = []
            real = local._run
            local._run = lambda args, **kw: (calls.append(args), real(args, **kw))[1]
            try:
                out, _ = local.git_activity(conn, cfg)
            finally:
                local._run = real
            self.assertEqual(sum("--numstat" in a for a in calls), 1)
            self.assertEqual(len(calls), 3)                              # log, rev-list, counts: not per commit
            got = {c["title"]: c["nFiles"] for c in out[0]["commits"]}
            self.assertEqual(got, {"feat: three files": 3, "feat: side": 1, "fix: one file": 1, "merge: side": 0})
            self.assertNotIn("zeta", repr(out))
            only_mine = local._file_counts(repo, 60, ["ME@example.com"])
            git(repo, "commit", "-q", "--allow-empty", "-m", "chore: theirs", email="other+x@example.com")
            self.assertEqual(len(only_mine), 4)                          # mine only, case ignored
            self.assertEqual(local._file_counts(repo, 60, ["me@example.com"]), only_mine)
            self.assertEqual(len(local._file_counts(repo, 60, ["other+x@example.com"])), 1)   # "+" is literal
            local._file_counts, saved = (lambda repo, days, emails: None), local._file_counts
            try:
                out, _ = local.git_activity(conn, cfg)
            finally:
                local._file_counts = saved
            self.assertEqual(len(out[0]["commits"]), 4)
            self.assertTrue(all("nFiles" not in c for c in out[0]["commits"]))
            conn.close()


if __name__ == "__main__":
    unittest.main()
