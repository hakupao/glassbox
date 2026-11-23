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


def _ago(sec):
    from datetime import UTC, datetime
    return datetime.fromtimestamp(datetime.now(UTC).timestamp() - sec, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _page(*machines):
    return {"schema": "glassbox.page/1", "view": "private",
            "machines": [{"id": f"m{i}", "online": on, "probeLastReport": last} for i, (on, last) in enumerate(machines)]}


class ProbeStaleTest(unittest.TestCase):
    """C9: kuma_probes reports machines that are up but whose probe stopped. Fabricated pages, no network."""
    URL = "https://kuma.example.org/api/push/probe-secret-token"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)
        (self.d / "kuma_probes").write_text(self.URL + "\n")
        self.env = {"GLASSBOX_PUBLISH_DIR": str(self.d)}

    def tearDown(self):
        self.tmp.cleanup()

    def push(self, page, env=None):
        """Run check_probes with the page; returns the list of (status, msg) pushed."""
        from urllib.parse import parse_qs, urlsplit
        calls = []
        with mock.patch.object(publish, "fetch_private", return_value=page), \
                mock.patch.object(publish.urllib.request, "urlopen", side_effect=lambda u, **k: calls.append(u) or mock.MagicMock()):
            publish.check_probes(env or self.env)
        out = []
        for u in calls:
            self.assertTrue(u.startswith(self.URL + "?"))
            q = parse_qs(urlsplit(u).query)
            out.append((q["status"][0], q["msg"][0]))
        return out

    def test_stale_and_online_is_down_with_counts_only(self):
        got = self.push(_page((True, _ago(3600)), (True, _ago(60)), (True, None)))
        self.assertEqual(got, [("down", "stale probes: 1 of 2")])

    def test_offline_no_probe_and_fresh_are_not_counted(self):
        got = self.push(_page((False, _ago(10 * 3600)), (True, None), (None, _ago(7200)), (True, _ago(1700))))
        self.assertEqual(got, [("up", "probes ok (3)")])

    def test_unreadable_report_time_counts_as_stale_when_online(self):
        self.assertEqual(self.push(_page((True, "not a time"))), [("down", "stale probes: 1 of 1")])

    def test_no_machines_is_up(self):
        self.assertEqual(self.push(_page()), [("up", "probes ok (0)")])

    def test_threshold_setting(self):
        page = _page((True, _ago(2400)))
        self.assertEqual(self.push(page)[0][0], "down")                                   # default 1800
        self.assertEqual(self.push(page, dict(self.env, GLASSBOX_PUBLISH_PROBESTALE="3600"))[0][0], "up")
        (self.d / "settings.toml").write_text("probeStale = 3600\n")
        self.assertEqual(self.push(page)[0][0], "up")
        lim = publish.probe_stale_limit
        self.assertEqual([lim({}), lim({"probeStale": "60"}), lim({"probeStale": "999999"}),
                          lim({"probeStale": "x"}), lim({"probeStale": "2400"}), lim({"probeStale": "1e999"})],
                         [1800, 900, 86400, 1800, 2400, 1800])

    def test_missing_empty_or_invalid_file_sends_nothing(self):
        import contextlib
        import io
        (self.d / "kuma_probes").unlink()
        self.assertEqual(self.push(_page((True, _ago(3600)))), [])
        (self.d / "kuma_probes").write_text("\n")
        self.assertEqual(self.push(_page((True, _ago(3600)))), [])
        (self.d / "kuma_probes").write_text("ftp://x/probe-secret-token\n")
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertEqual(self.push(_page((True, _ago(3600)))), [])
        self.assertIn("kuma_probes is not a valid", err.getvalue())
        self.assertNotIn("probe-secret-token", err.getvalue())

    def test_fetch_failure_pushes_nothing(self):
        calls = []
        with mock.patch.object(publish, "fetch_private", side_effect=publish.PublishError("cannot fetch")), \
                mock.patch.object(publish.urllib.request, "urlopen", side_effect=lambda u, **k: calls.append(u)):
            publish.check_probes(self.env)
        self.assertEqual(calls, [])

    def test_runs_when_publishing_is_disabled_and_never_logs_the_url(self):
        import contextlib
        import io
        (self.d / "kuma_push").write_text("https://kuma.example.org/api/push/publish-secret-token\n")
        calls, out = [], io.StringIO()
        page = _page((True, _ago(3600)))
        with mock.patch.object(publish, "fetch_private", return_value=page), \
                mock.patch.object(publish.urllib.request, "urlopen", side_effect=lambda u, **k: calls.append(u) or mock.MagicMock()), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            rc = publish.main([], env=self.env)                                          # no token: disabled
        self.assertEqual(rc, 0)
        self.assertIn("publish: disabled", out.getvalue())
        self.assertEqual(len(calls), 1)                                                  # kuma_probes only
        self.assertTrue(calls[0].startswith(self.URL))
        self.assertIn("stale+probes%3A+1+of+1", calls[0])

        calls.clear()
        with mock.patch.object(publish, "fetch_private", return_value=page), \
                mock.patch.object(publish.urllib.request, "urlopen", side_effect=OSError(self.URL)), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            publish.main([], env=dict(self.env, GLASSBOX_PUBLISH_PROBESTALE="x"))
        self.assertIn("kuma probes failed", out.getvalue())
        for secret in ("probe-secret-token", "publish-secret-token"):
            self.assertNotIn(secret, out.getvalue())

    def test_runs_when_publishing_fails(self):
        import contextlib
        import io
        calls = []
        with mock.patch.object(publish, "run_once", side_effect=publish.PublishError("x")), \
                mock.patch.object(publish, "fetch_private", return_value=_page((True, _ago(60)))), \
                mock.patch.object(publish.urllib.request, "urlopen", side_effect=lambda u, **k: calls.append(u) or mock.MagicMock()), \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            rc = publish.main([], env=self.env)
        self.assertEqual(rc, 1)
        self.assertEqual(len(calls), 1)
        self.assertIn("probes+ok+%281%29", calls[0])

    def test_hub_timestamp_format_and_boundary(self):
        from datetime import datetime, timedelta
        from zoneinfo import ZoneInfo
        last = (datetime.now(ZoneInfo("Asia/Tokyo")) - timedelta(seconds=3600)).isoformat(timespec="seconds")
        self.assertEqual(self.push(_page((True, last))), [("down", "stale probes: 1 of 1")])
        now = datetime(2026, 11, 17, 11, 0, tzinfo=ZoneInfo("Asia/Tokyo"))
        at = lambda sec: (now - timedelta(seconds=sec)).isoformat(timespec="seconds")
        self.assertEqual(publish.stale_probes(_page((True, at(1800))), now.timestamp(), 1800), (0, 1))   # age == limit
        self.assertEqual(publish.stale_probes(_page((True, at(1801))), now.timestamp(), 1800), (1, 1))

    def test_machines_built_by_hub_page(self):
        """online comes from hub.page: Beszel up + stale probe counts; Beszel down or stale does not."""
        from datetime import datetime, timezone
        from hub import db, page
        now = datetime(2026, 11, 17, 2, 0, tzinfo=timezone.utc)
        t = now.timestamp()
        conn = db.connect(self.d / "hub.sqlite")
        try:
            for m in ("up", "down", "gone", "fresh", "noprobe"):
                conn.execute("INSERT INTO machines(id, role, os, last_report) VALUES(?, 'dev', 'macos', ?)",
                             (m, None if m == "noprobe" else t - (60 if m == "fresh" else 3600)))
            conn.execute("INSERT INTO machine_state VALUES('up', 'up', 3600, ?)", (t - 30,))
            conn.execute("INSERT INTO machine_state VALUES('down', 'down', 3600, ?)", (t - 30,))
            conn.execute("INSERT INTO machine_state VALUES('gone', 'up', 3600, ?)", (t - 2 * 3600,))   # Beszel stale
            conn.execute("INSERT INTO machine_state VALUES('noprobe', 'up', 3600, ?)", (t - 30,))
            built = page.build(conn, {"tz": "Asia/Tokyo"}, now)
        finally:
            conn.close()
        online = {m["id"]: m["online"] for m in built["machines"]}
        self.assertEqual(online, {"up": True, "down": False, "gone": False, "fresh": True, "noprobe": True})
        self.assertEqual(publish.stale_probes(built, t, 1800), (1, 4))

    def test_non_utf8_url_file_is_ignored(self):
        import contextlib
        import io
        (self.d / "kuma_probes").write_bytes(b"https://kuma.example.org/\xff\xfe\n")
        (self.d / "kuma_push").write_bytes(b"\xff\xfe\n")
        calls = []
        with mock.patch.object(publish, "run_once", side_effect=publish.PublishError("x")), \
                mock.patch.object(publish, "fetch_private", return_value=_page((True, _ago(3600)))), \
                mock.patch.object(publish.urllib.request, "urlopen", side_effect=lambda u, **k: calls.append(u) or mock.MagicMock()), \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            rc = publish.main([], env=self.env)                                          # failing branch: no raise
        self.assertEqual((rc, calls), (1, []))

    def test_probe_check_failure_does_not_stop_publishing(self):
        import contextlib
        import io
        (self.d / "token").write_text("fake-token\n")
        out = io.StringIO()
        with mock.patch.object(publish, "run_once", return_value="published") as ro, \
                mock.patch.object(publish, "check_probes", side_effect=RuntimeError("boom")), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            rc = publish.main([], env=self.env)
        ro.assert_called_once()
        self.assertEqual(rc, 0)
        self.assertIn("probe check failed (RuntimeError)", out.getvalue())



class CheckConfigTest(unittest.TestCase):
    """--check-config, as scripts/sync_publish.sh --apply runs it in the publisher container."""
    def run_check(self, name, data):
        import subprocess
        import sys
        return subprocess.run([sys.executable, "-m", "hub.publish", "--check-config", name], cwd=ROOT,
                              input=data, capture_output=True)

    def test_answers(self):
        for name, data, line, rc in [("public.toml", b'keywords = ["k"]\n', b"ok", 0),
                                     ("public.toml", b"zz = 1\nyy = 2\n", b"unknown keys: 2", 1),
                                     ("terms.json", b'{"terms": ["x"]}', b"ok", 0),
                                     ("public.toml", b"\xff\xfe not utf-8", b"rejected", 1),
                                     ("terms.json", b"\xff\xfe", b"rejected", 1)]:
            with self.subTest(name=name, data=data):
                r = self.run_check(name, data)
                self.assertEqual((r.stdout.strip(), r.returncode), (line, rc))
                self.assertEqual(r.stderr, b"")


if __name__ == "__main__":
    unittest.main()
