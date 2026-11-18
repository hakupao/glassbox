"""Publisher (S15) against a fake hub and a fake GitHub Git Data API. Fabricated data only."""
import base64
import json
import shutil
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from hub import publish

ROOT = Path(__file__).resolve().parent.parent
RT = ROOT / "tests" / "redteam" / "context"
PRIVATE = json.loads((ROOT / "schema" / "examples" / "page.private.json").read_text(encoding="utf-8"))


class FakeGitHub:
    """Just enough of /repos/{o}/{r}/git/... with in-memory objects."""
    def __init__(self):
        self.objs, self.refs, self.writes, self.n, self.fail = {}, {}, [], 0, None

    def new(self, obj):
        self.n += 1
        sha = f"{self.n:040x}"
        self.objs[sha] = obj
        return sha


def make_handler(gh, page):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, obj=None):
            body = b"" if obj is None else json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            p = self.path
            if p == "/page.json":
                return self._send(200, page)
            if not self.headers.get("Authorization", "").startswith("Bearer "):
                return self._send(401)
            rest = p.split("/git/", 1)[1]
            if rest.startswith("ref/heads/"):
                b = rest[len("ref/heads/"):]
                return self._send(200, {"object": {"sha": gh.refs[b]}}) if b in gh.refs else self._send(404)
            kind, sha = rest.split("/", 1)
            obj = gh.objs.get(sha)
            if kind == "commits":
                return self._send(200, {"tree": {"sha": obj["tree"]}})
            if kind == "trees":
                return self._send(200, {"tree": [dict(e, type="blob") for e in obj["tree"]]})
            return self._send(404)

        def _body(self):
            return json.loads(self.rfile.read(int(self.headers["Content-Length"])))

        def do_POST(self):
            rest, body = self.path.split("/git/", 1)[1], self._body()
            gh.writes.append(("POST", rest))
            if gh.fail == rest:
                return self._send(500)
            if rest == "blobs":
                data = base64.b64decode(body["content"])
                sha = publish.git_blob_sha(data)
                gh.objs.setdefault(sha, data)
                return self._send(201, {"sha": sha})
            if rest == "trees":
                return self._send(201, {"sha": gh.new({"tree": body["tree"]})})
            if rest == "commits":
                return self._send(201, {"sha": gh.new(body)})
            if rest == "refs":
                gh.refs[body["ref"].removeprefix("refs/heads/")] = body["sha"]
                return self._send(201, {})
            return self._send(404)

        def do_PATCH(self):
            rest, body = self.path.split("/git/", 1)[1], self._body()
            gh.writes.append(("PATCH", rest))
            b = rest.removeprefix("refs/heads/")
            if b not in gh.refs or not body.get("force"):
                return self._send(422)
            gh.refs[b] = body["sha"]
            return self._send(200, {})
    return H


class PublishTest(unittest.TestCase):
    def setUp(self):
        self.gh = FakeGitHub()
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.gh, PRIVATE))
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.srv.server_address[1]}"
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        shutil.copy(RT / "terms.json", d / "terms.json")
        shutil.copy(RT / "public.toml", d / "public.toml")
        (d / "token").write_text("fake-token\n")
        self.env = {"GLASSBOX_PUBLISH_DIR": str(d), "GLASSBOX_PUBLISH_REPO": "o/r",
                    "GLASSBOX_PUBLISH_CNAME": "status.example.org", "GLASSBOX_PUBLISH_SOURCE": self.base + "/page.json"}

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.tmp.cleanup()

    def run_once(self, env=None):
        return publish.run_once(env or self.env, api=self.base)

    def tip_files(self, branch="gh-pages"):
        commit = self.gh.objs[self.gh.refs[branch]]
        return commit, {e["path"]: self.gh.objs[e["sha"]] for e in self.gh.objs[commit["tree"]]["tree"]}

    def test_disabled_without_token(self):
        (Path(self.tmp.name) / "token").unlink()
        self.assertEqual(self.run_once(), "disabled")
        self.assertEqual(self.gh.writes, [])

    def test_first_publish_creates_a_parentless_two_file_commit(self):
        self.assertEqual(self.run_once(), "published")
        commit, files = self.tip_files()
        self.assertEqual(commit["parents"], [])
        self.assertEqual(sorted(files), ["CNAME", "index.html"])
        self.assertEqual(files["CNAME"], b"status.example.org\n")
        self.assertIn(b"<html", files["index.html"][:500].lower())
        self.assertIn(("POST", "refs"), self.gh.writes)

    def test_unchanged_snapshot_writes_nothing_and_changes_force_replace(self):
        self.run_once()
        first = self.gh.refs["gh-pages"]
        self.gh.writes.clear()
        self.assertEqual(self.run_once(), "unchanged")
        self.assertEqual(self.gh.writes, [])
        env = dict(self.env, GLASSBOX_PUBLISH_CNAME="status2.example.org")
        self.assertEqual(self.run_once(env), "published")
        commit, files = self.tip_files()
        self.assertNotEqual(self.gh.refs["gh-pages"], first)
        self.assertEqual(commit["parents"], [])                      # still no history
        self.assertEqual(files["CNAME"], b"status2.example.org\n")
        self.assertIn(("PATCH", "refs/heads/gh-pages"), self.gh.writes)

    def test_gate_rejection_publishes_nothing(self):
        terms = json.loads((RT / "terms.json").read_text(encoding="utf-8"))
        leaked = terms["terms"][0]
        with mock.patch.object(publish, "bundle", lambda pub: f"<!doctype html><html><body>{leaked}</body></html>"):
            with self.assertRaises(publish.PublishError) as cm:
                self.run_once()
        self.assertIn("gate", str(cm.exception))
        self.assertNotIn(leaked, str(cm.exception))
        self.assertEqual(self.gh.writes, [])

    def test_settings_file_is_read(self):
        d = Path(self.tmp.name)
        (d / "settings.toml").write_text(f'repo = "o/r"\ncname = "file.example.org"\nsource = "{self.base}/page.json"\n')
        env = {"GLASSBOX_PUBLISH_DIR": str(d)}
        self.assertEqual(self.run_once(env), "published")
        self.assertEqual(self.tip_files()[1]["CNAME"], b"file.example.org\n")

    def test_failure_midway_leaves_the_branch_untouched(self):
        self.run_once()
        before = self.gh.refs["gh-pages"]
        self.gh.fail = "trees"
        with self.assertRaises(publish.PublishError):
            self.run_once(dict(self.env, GLASSBOX_PUBLISH_CNAME="other.example.org"))
        self.assertEqual(self.gh.refs["gh-pages"], before)
        self.assertNotIn("PATCH", [m for m, _ in self.gh.writes])

    def test_only_the_pages_branch_is_ever_written(self):
        for branch in ("develop", "Main", "gh-pages/../main", "heads/main", "refs/heads/main"):
            with self.assertRaises(publish.PublishError):
                self.run_once(dict(self.env, GLASSBOX_PUBLISH_BRANCH=branch))
        self.assertEqual(self.gh.writes, [])

    def test_logs_never_carry_the_token_or_the_kuma_url(self):
        import contextlib
        import io
        d = Path(self.tmp.name)
        (d / "token").write_text("fake-token-SECRET123\n")
        (d / "kuma_push").write_text("not a url with secret-push-token\n")
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(err):
            rc_ok = publish.main([], env=dict(self.env), api=self.base)
            (d / "kuma_push").write_text("http://127.0.0.1:1/push/secret-push-token\n")     # refused port
            rc_bad = publish.main([], env=dict(self.env, GLASSBOX_PUBLISH_BRANCH="develop"), api=self.base)
        out = err.getvalue()
        self.assertEqual((rc_ok, rc_bad), (0, 1), out)
        for secret in ("SECRET123", "secret-push-token"):
            self.assertNotIn(secret, out)
        self.assertIn("kuma_push is not a valid", out)
        self.assertIn("kuma push failed", out)

    def test_refuses_code_branches_and_missing_settings(self):
        for branch in ("main", "master"):
            with self.assertRaises(publish.PublishError):
                self.run_once(dict(self.env, GLASSBOX_PUBLISH_BRANCH=branch))
        with self.assertRaises(publish.PublishError):
            self.run_once({k: v for k, v in self.env.items() if k != "GLASSBOX_PUBLISH_CNAME"})
        self.assertEqual(self.gh.writes, [])

    def test_public_page_as_source_is_refused(self):
        pub = json.loads((ROOT / "schema" / "examples" / "page.public.json").read_text(encoding="utf-8"))
        srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.gh, pub))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            with self.assertRaises(publish.PublishError):
                self.run_once(dict(self.env, GLASSBOX_PUBLISH_SOURCE=f"http://127.0.0.1:{srv.server_address[1]}/page.json"))
        finally:
            srv.shutdown()
            srv.server_close()
        self.assertEqual(self.gh.writes, [])


if __name__ == "__main__":
    unittest.main()
