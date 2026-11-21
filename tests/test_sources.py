"""Gitea collector against a fake Gitea API on loopback (fabricated data)."""
import contextlib
import io
import json
import os
from unittest import mock
import tempfile
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from hub import db, sources

REPOS = [{"full_name": "team/app", "name": "app", "default_branch": "main"}]
COMMITS = [
    {"sha": "a" * 40, "html_url": "http://gitea.test/team/app/commit/aaa", "author": {"login": "me"},
     "commit": {"message": "feat: mine\n\nbody", "author": {"email": "x@example.com", "date": "2026-11-16T09:00:00+09:00"}}},
    {"sha": "b" * 40, "html_url": "http://gitea.test/team/app/commit/bbb", "author": {"login": "someone"},
     "commit": {"message": "fix: theirs", "author": {"email": "other@example.com", "date": "2026-11-16T10:00:00+09:00"}}},
    {"sha": "c" * 40, "html_url": "http://gitea.test/team/app/commit/ccc", "author": None,
     "commit": {"message": "chore: by e-mail", "author": {"email": "Me@Example.com", "date": "2026-11-16T11:00:00Z"}}},
]


class FakeGitea(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.headers.get("Authorization") != "token t0k":
            self.send_response(401)
            self.end_headers()
            return
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path == "/api/v1/user/repos":
            body = REPOS if q.get("page") == ["1"] else []
        elif u.path == "/api/v1/repos/team/app/commits":
            body = COMMITS if q.get("page") == ["1"] else []
        else:
            self.send_response(404)
            self.end_headers()
            return
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class GiteaTest(unittest.TestCase):
    def test_commits_by_login_or_email_are_private(self):
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), FakeGitea)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        with tempfile.TemporaryDirectory() as d:
            conn = db.connect(Path(d) / "hub.sqlite")
            self.enterContext(mock.patch.dict(os.environ, {"FAKE_GITEA_TOKEN": "t0k"}))
            cfg = {"author_emails": ["me@example.com"], "gitea": [{
                "name": "test", "url": f"http://127.0.0.1:{httpd.server_address[1]}", "user": "me",
                "token_env": "FAKE_GITEA_TOKEN"}]}
            out = sources.gitea(conn, cfg)
            self.assertEqual(out["test"], {"repos": 1, "commits": 2, "failed": 0})
            rows = conn.execute("SELECT hash, t, title, private, remote FROM commits ORDER BY t").fetchall()
            self.assertEqual([r[2] for r in rows], ["feat: mine", "chore: by e-mail"])
            self.assertEqual(rows[0][1], "2026-11-16T00:00:00Z")          # normalized to UTC
            self.assertTrue(all(r[3] == 1 for r in rows))                  # Gitea is always private
            self.assertEqual(rows[0][4], "127.0.0.1/team/app")
            conn.close()
        httpd.shutdown()
        httpd.server_close()

    def test_visibility_flip_relabels_stored_commits(self):
        with tempfile.TemporaryDirectory() as d:
            conn = db.connect(Path(d) / "hub.sqlite")
            conn.execute(sources.INSERT, ("github", "d" * 40, "2026-11-16T00:00:00Z", "r", "github.com/o/r",
                                          "main", "t", "u", 0))
            sources.set_visibility(conn, "github.com/o/r", "private")
            self.assertEqual(conn.execute("SELECT private FROM commits").fetchone()[0], 1)
            conn.close()

    def test_next_link(self):
        h = {"Link": '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=9>; rel="last"'}
        self.assertEqual(sources._next_link(h), "https://api.github.com/x?page=2")
        self.assertIsNone(sources._next_link({}))


GH_FILES = {"1" * 40: [{"filename": "docs/a.md", "status": "modified"}, {"filename": "src/new.py", "status": "added"},
                       {"filename": "old.txt", "status": "removed"}, {"filename": "b/moved.md", "status": "renamed"},
                       {"filename": "c.md", "status": "copied"}, {"filename": "d.md", "status": "changed"}],
            "2" * 40: [{"filename": f"f{i}.py", "status": "added"} for i in range(70)]}


class FakeGitHub(BaseHTTPRequestHandler):
    calls = []
    rate_limit_after = None

    def log_message(self, *a):
        pass

    def do_GET(self):
        FakeGitHub.calls.append(self.path)
        sha = self.path.rsplit("/", 1)[-1]
        if FakeGitHub.rate_limit_after is not None and len(FakeGitHub.calls) > FakeGitHub.rate_limit_after:
            self.send_response(429)
            self.end_headers()
            return
        if sha == "9" * 40:                                # secondary rate limit: 403 with Retry-After
            self.send_response(403)
            self.send_header("Retry-After", "60")
            self.end_headers()
            return
        if sha == "7" * 40:                                # the connection drops mid-answer
            self.send_response(200)
            self.send_header("Content-Length", "500")
            self.end_headers()
            self.wfile.write(b'{"files": [')
            return
        if sha == "8" * 40:                                # not JSON
            self.send_response(200)
            self.send_header("Content-Length", "4")
            self.end_headers()
            self.wfile.write(b"oops")
            return
        if self.path.startswith("/repos/o/r/commits/") and sha in GH_FILES:
            data = json.dumps({"sha": sha, "files": GH_FILES[sha]}).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_response(500 if sha == "5" * 40 else 404)
        self.end_headers()

    def do_POST(self):                                     # GraphQL: the viewer, no repositories
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        data = json.dumps({"data": {"viewer": {"login": "example-owner", "contributionsCollection": {
            "contributionCalendar": {"totalContributions": 0, "weeks": []}, "commitContributionsByRepository": []}}}}).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class GitHubFilesTest(unittest.TestCase):
    """S17 R09: file lists from GitHub's single-commit endpoint, cached by hash, against a fake API."""

    def setUp(self):
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), FakeGitHub)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.api = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = db.connect(Path(self.tmp.name) / "hub.sqlite")
        FakeGitHub.calls, FakeGitHub.rate_limit_after = [], None
        for i, (h, private, remote) in enumerate((("1" * 40, 0, "github.com/o/r"), ("2" * 40, 0, "github.com/o/r"),
                                                  ("3" * 40, 0, "github.com/o/r"), ("4" * 40, 1, "github.com/o/r"),
                                                  ("5" * 40, 0, "github.com/o/r"))):
            self.conn.execute(sources.INSERT, ("github", h, f"2026-11-1{i}T00:00:00Z", "r", remote, "main", "t", "u", private))
        self.conn.execute("INSERT INTO commits(source, hash, machine, t, pushed) VALUES('local', ?, 'A', '2026-11-19T00:00:00Z', 1)", ("6" * 40,))

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()
        self.httpd.shutdown()
        self.httpd.server_close()

    def rows(self):
        return {h: (n, None if f is None else json.loads(f), fetched is not None)
                for h, n, f, fetched in self.conn.execute("SELECT hash, n, files, fetched FROM commit_files")}

    def test_lists_statuses_cache_and_errors(self):
        self.conn.execute("INSERT INTO commit_files(hash, n) VALUES(?, 4)", ("3" * 40,))      # a probe count
        done = sources.fetch_files(self.conn, "t", self.api)
        r = self.rows()
        self.assertEqual(r["1" * 40][1], [{"s": "M", "p": "docs/a.md"}, {"s": "A", "p": "src/new.py"}, {"s": "D", "p": "old.txt"},
                                          {"s": "R", "p": "b/moved.md"}, {"s": "A", "p": "c.md"}, {"s": "M", "p": "d.md"}])
        self.assertEqual((r["2" * 40][0], len(r["2" * 40][1])), (70, 50))                    # truncated; n is the total
        self.assertEqual(r["3" * 40], (4, None, True))                                       # 404: cached, probe count kept
        self.assertNotIn("4" * 40, r)                                                        # private: never asked
        self.assertNotIn("5" * 40, r)                                                        # 500: retried next run
        self.assertNotIn("6" * 40, r)                                                        # local only: never asked
        self.assertEqual(done, 3)
        self.assertFalse(any(("4" * 40) in c or ("6" * 40) in c for c in FakeGitHub.calls))
        FakeGitHub.calls = []
        sources.fetch_files(self.conn, "t", self.api)
        self.assertEqual([c.rsplit("/", 1)[-1] for c in FakeGitHub.calls], ["5" * 40])     # cached for good

    def test_collector_stores_the_login_and_fetches_files_last(self):
        env = mock.patch.dict(os.environ, {"FAKE_GH_TOKEN": "t"})
        env.start()
        self.addCleanup(env.stop)
        self.conn.execute("INSERT INTO projects(key, name, remote, visibility, checked) VALUES('p_r', 'r', 'github.com/o/r', "
                          "'public', strftime('%s', 'now'))")      # visibility fresh: no lookup
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            out = sources.github(self.conn, {"github": {"token_env": "FAKE_GH_TOKEN", "api": self.api}})
        self.assertEqual(db.get(self.conn, "github.login"), "example-owner")
        self.assertEqual(out["files_fetched"], 3)
        FakeGitHub.rate_limit_after = 0                    # a rate limit in the file fetch does not fail the run
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(sources.github(self.conn, {"github": {"token_env": "FAKE_GH_TOKEN", "api": self.api}})["files_fetched"],
                             "rate limited")

    def test_network_and_parse_failures_skip_the_commit_not_the_run(self):
        for h, t in (("7" * 40, "2026-11-20T00:00:00Z"), ("8" * 40, "2026-11-21T00:00:00Z")):
            self.conn.execute(sources.INSERT, ("github", h, t, "r", "github.com/o/r", "main", "t", "u", 0))
        with contextlib.redirect_stderr(io.StringIO()) as err:
            done = sources.fetch_files(self.conn, "t", self.api)
        self.assertEqual(done, 3)                                                          # 1, 2 and the 404 of 3
        self.assertTrue({"1" * 40, "2" * 40} <= set(self.rows()))
        self.assertFalse({"7" * 40, "8" * 40} & set(self.rows()))                          # retried next run
        self.assertNotIn("o/r", err.getvalue())                                            # class names only, no URL
        sources.FAILS_IN_A_ROW, saved = 1, sources.FAILS_IN_A_ROW
        try:
            FakeGitHub.calls = []
            with contextlib.redirect_stderr(io.StringIO()):
                sources.fetch_files(self.conn, "t", self.api)
            self.assertEqual(len(FakeGitHub.calls), 1)                                     # stops after the first failure
        finally:
            sources.FAILS_IN_A_ROW = saved

    def test_secondary_rate_limit_stops_the_fetch(self):
        self.conn.execute(sources.INSERT, ("github", "9" * 40, "2026-11-30T00:00:00Z", "r", "github.com/o/r", "main", "t", "u", 0))
        with self.assertRaises(sources.RateLimited):
            sources.fetch_files(self.conn, "t", self.api)

    def test_probe_count_first_then_a_smaller_list_keeps_the_larger(self):
        self.conn.execute("INSERT INTO commit_files(hash, n) VALUES(?, 80)", ("1" * 40,))     # probe saw 80 files
        sources.fetch_files(self.conn, "t", self.api)
        self.assertEqual(self.rows()["1" * 40][0], 80)                                       # list of 6, n stays 80

    def test_newest_first_bounded_and_rate_limit_keeps_progress(self):
        sources.fetch_files(self.conn, "t", self.api, limit=2)
        self.assertEqual([c.rsplit("/", 1)[-1] for c in FakeGitHub.calls], ["5" * 40, "3" * 40])
        FakeGitHub.calls, FakeGitHub.rate_limit_after = [], 2       # 5 (500), 2 (ok), then 429 on 1
        with self.assertRaises(sources.RateLimited):
            sources.fetch_files(self.conn, "t", self.api)
        self.assertIn("2" * 40, self.rows())                                                 # saved before the stop
        self.assertNotIn("1" * 40, self.rows())


if __name__ == "__main__":
    unittest.main()
