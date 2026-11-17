"""Hub ingest rules (CONTRACT §1.1) and the HTTP endpoint, on fabricated reports."""
import copy
import gzip
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path

from hub import db, ingest, server

NOW = datetime(2026, 11, 17, 2, 0, tzinfo=timezone.utc)


def tok(n):
    return {"input": n, "output": n, "cacheRead": n, "cacheWrite": n, "reasoning": 0}


def report(rows, frm="2026-11-13T00:00:00Z", to="2026-11-17T02:00:00Z", **extra):
    rep = {"schema": "glassbox.probe/1", "machine": "A", "probeVersion": "0.1.0",
           "usage": {"range": {"from": frm, "to": to},
                     "rows": [{"hourStart": h, "agent": "claude-code", "model": "claude-opus-5-5", "project": "p_x",
                               "requests": n, "unpricedRequests": 0, "tokens": tok(n), "costUsd": n / 100}
                              for h, n in rows],
                     "sessions": [{"hourStart": rows[0][0], "agent": "claude-code", "project": "p_x", "count": 1}] if rows else []},
           "projects": {"p_x": {"name": "demo", "remote": None}}}
    rep.update(extra)
    return rep


class IngestTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = db.connect(Path(self.tmp.name) / "hub.sqlite")
        self.conn.execute("INSERT INTO machines(id) VALUES('A')")

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def hours(self):
        return dict(self.conn.execute("SELECT hour, SUM(requests) FROM usage GROUP BY hour"))

    def test_range_is_replaced_not_added(self):
        ingest.apply(self.conn, "A", report([("2026-11-17T01:00:00Z", 10)]), NOW)
        ingest.apply(self.conn, "A", report([("2026-11-17T01:00:00Z", 12)]), NOW)
        self.assertEqual(self.hours(), {"2026-11-17T01:00:00Z": 12})
        self.assertEqual(self.conn.execute("SELECT SUM(count) FROM sessions").fetchone()[0], 1)

    def test_old_hours_do_not_shrink_but_recent_ones_may(self):
        ingest.apply(self.conn, "A", report([("2026-11-13T05:00:00Z", 100), ("2026-11-17T01:00:00Z", 10)]), NOW)
        ingest.apply(self.conn, "A", report([("2026-11-13T05:00:00Z", 40), ("2026-11-17T01:00:00Z", 5)]), NOW)
        self.assertEqual(self.hours(), {"2026-11-13T05:00:00Z": 100, "2026-11-17T01:00:00Z": 5})
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM warnings WHERE kind='shrink'").fetchone()[0], 1)

    def test_rebaseline_needs_newer_probe_or_manual_window(self):
        ingest.apply(self.conn, "A", report([("2026-11-13T05:00:00Z", 100)]), NOW)
        r = report([("2026-11-13T05:00:00Z", 40)])
        r["usage"]["rebaseline"] = True
        ingest.apply(self.conn, "A", r, NOW)                      # same probe version: refused
        self.assertEqual(self.hours()["2026-11-13T05:00:00Z"], 100)
        r2 = copy.deepcopy(r)
        r2["probeVersion"] = "0.2.0"
        ingest.apply(self.conn, "A", r2, NOW)                     # newer probe: accepted
        self.assertEqual(self.hours()["2026-11-13T05:00:00Z"], 40)

    def test_rejects_mismatched_machine_undeclared_project_and_bad_hours(self):
        bad = report([("2026-11-17T01:00:00Z", 1)])
        bad["machine"] = "B"
        with self.assertRaises(ingest.Rejected):
            ingest.apply(self.conn, "A", bad, NOW)
        bad = report([("2026-11-17T01:00:00Z", 1)], projects={})
        with self.assertRaises(ingest.Rejected):
            ingest.apply(self.conn, "A", bad, NOW)
        with self.assertRaises(ingest.Rejected):
            ingest.apply(self.conn, "A", report([("2026-11-17T01:30:00Z", 1)]), NOW)
        with self.assertRaises(ingest.Rejected):
            ingest.apply(self.conn, "A", report([("2026-11-20T01:00:00Z", 1)]), NOW)
        self.assertEqual(self.hours(), {})                        # nothing half-applied

    def test_git_snapshot_replaces_per_project(self):
        g = lambda hashes: {"git": [{"project": "p_x", "remote": False, "commits": [
            {"t": "2026-11-16T00:00:00Z", "hash": h, "branch": "main", "title": "t", "pushed": False} for h in hashes]}]}
        ingest.apply(self.conn, "A", report([], **g(["a" * 40, "b" * 40])), NOW)
        ingest.apply(self.conn, "A", report([], **g(["c" * 40])), NOW)  # rebased: a, b are gone
        self.assertEqual([r[0] for r in self.conn.execute("SELECT hash FROM commits")], ["c" * 40])


class HttpTest(unittest.TestCase):
    def test_token_required_and_gzip_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            conn = db.connect(Path(d) / "hub.sqlite")
            conn.execute("INSERT INTO machines(id, token_sha) VALUES('A', ?)", (server.token_sha("secret-a"),))
            conn.commit()
            httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(server.Hub(conn)))
            threading.Thread(target=httpd.serve_forever, daemon=True).start()
            url = f"http://127.0.0.1:{httpd.server_address[1]}/ingest"
            body = gzip.compress(json.dumps(report([("2026-11-17T01:00:00Z", 3)])).encode())

            def post(token):
                req = urllib.request.Request(url, data=body, method="POST", headers={
                    "Authorization": f"Bearer {token}", "Content-Encoding": "gzip"})
                try:
                    with urllib.request.urlopen(req, timeout=10) as r:
                        return r.status, json.loads(r.read())
                except urllib.error.HTTPError as e:
                    return e.code, json.loads(e.read())

            self.assertEqual(post("wrong")[0], 401)
            code, res = post("secret-a")
            self.assertEqual(code, 200, res)
            self.assertEqual(res["rows"], 1)
            httpd.shutdown()
            httpd.server_close()
            conn.close()


if __name__ == "__main__":
    unittest.main()
