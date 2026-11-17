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


if __name__ == "__main__":
    unittest.main()
