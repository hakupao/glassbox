"""Gitea collector against a fake Gitea API on loopback (fabricated data)."""
import json
import os
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
            os.environ["FAKE_GITEA_TOKEN"] = "t0k"
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


if __name__ == "__main__":
    unittest.main()
