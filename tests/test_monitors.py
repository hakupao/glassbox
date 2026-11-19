"""Monitor collectors against fake Beszel / Kuma / Docker / tailscaled APIs (fabricated data)."""
import copy
import json
import os
import socket
import tempfile
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from pathlib import Path

from hub import db, monitors

S1, S2, SX = "a" * 15, "b" * 15, "c" * 15
BASE_ROUTES = {
    "/api/collections/users/auth-with-password": {"token": "tk"},
    "/api/collections/systems/records": {"items": [
        {"id": S1, "name": "home-box", "status": "up", "info": {"u": 3600}},
        {"id": S2, "name": "vm-box", "status": "up", "info": {"u": 60}},
        {"id": SX, "name": "unlisted-box", "status": "up", "info": {"u": 1}}], "totalPages": 1},
    "/api/collections/system_stats/records": {"items": [
        {"created": "2026-11-17 01:00:00.000Z", "stats": {"cpu": 12.5, "m": 16, "mu": 8, "d": 500, "du": 100}}],
        "totalPages": 1},
    "/api/collections/container_stats/records": {"items": [{"stats": [{"n": "web", "c": 1.5, "m": 256}]}]},
    "/api/status-page/lan": {"publicGroupList": [{"monitorList": [
        {"id": 7, "name": "site"}, {"id": 8, "name": "queue"}, {"id": 9, "name": "backup"}]}]},
    "/api/status-page/heartbeat/lan": {"heartbeatList": {"7": [{"status": 1}, {"status": 0}], "8": [{"status": 2}],
                                                         "9": [{"status": 3}]}, "uptimeList": {"7_24": 0.9876}},
    "/containers/json": [{"Names": ["/web"], "State": "running"}, {"Names": ["/loop"], "State": "restarting"},
                         {"Id": "0123456789abcdef", "State": "exited"}],
    "/localapi/v0/status": {"Self": {"HostName": "me", "DNSName": "me.tail.ts.net.", "OS": "linux", "Online": True,
                                     "LastSeen": "0001-01-01T00:00:00Z"},
                            "Peer": {"k1": {"HostName": "localhost", "DNSName": "phone-a.tail.ts.net.", "OS": "android"},
                                     "k2": {"HostName": "localhost", "DNSName": "phone-b.tail.ts.net.", "OS": "android",
                                            "Online": True, "LastSeen": "2026-11-17T00:00:00Z"}}},
    "/redirect": None,
}


class Fake(BaseHTTPRequestHandler):
    routes = BASE_ROUTES
    seen = []
    fail = set()

    def log_message(self, *a):
        pass

    def address_string(self):
        return "local"

    def _reply(self):
        u = urllib.parse.urlparse(self.path)
        Fake.seen.append((u.path, urllib.parse.parse_qs(u.query)))
        if u.path in Fake.fail:
            self.send_response(500)
            self.end_headers()
            return
        if u.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "http://198.51.100.1/steal")
            self.end_headers()
            return
        if u.path.startswith("/api/collections/") and "auth-with-password" not in u.path \
                and self.headers.get("Authorization") != "tk":
            self.send_response(401)
            self.end_headers()
            return
        body = Fake.routes.get(u.path)
        if body is None:
            self.send_response(404)
            self.end_headers()
            return
        n = int(self.headers.get("Content-Length") or 0)
        if n:
            self.rfile.read(n)
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_POST = _reply


class UnixServer(HTTPServer):
    address_family = socket.AF_UNIX

    def server_bind(self):
        self.socket.bind(self.server_address)
        self.server_name, self.server_port = "local", 0


class MonitorsTest(unittest.TestCase):
    def setUp(self):
        Fake.routes, Fake.seen, Fake.fail = copy.deepcopy(BASE_ROUTES), [], set()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self.tmp = tempfile.TemporaryDirectory()
        self.sock = os.path.join(self.tmp.name, "ts.sock")
        self.ux = UnixServer(self.sock, Fake)
        threading.Thread(target=self.ux.serve_forever, daemon=True).start()
        self.conn = db.connect(Path(self.tmp.name) / "hub.sqlite")
        os.environ["FAKE_BESZEL_PW"] = "pw"
        self.cfg = {"beszel": {"url": self.url, "user": "u", "password_env": "FAKE_BESZEL_PW",
                               "map": {"home-box": "C", "vm-box": "V"}},
                    "kuma": {"url": self.url, "slug": "lan", "machine": "V"},
                    "docker": {"url": self.url, "machine": "V"},
                    "tailscale": {"socket": self.sock}}

    def tearDown(self):
        os.environ.pop("FAKE_BESZEL_PW", None)
        self.conn.close()
        for s in (self.ux, self.httpd):
            s.shutdown()
            s.server_close()
        self.tmp.cleanup()

    def q(self, sql):
        return self.conn.execute(sql).fetchall()

    def test_collect_all(self):
        out = monitors.collect(self.conn, self.cfg)
        self.assertEqual(out["beszel"]["unmapped"], 1)
        self.assertEqual(db.get(self.conn, "beszel.unmapped"), "1")
        self.assertEqual(sorted(r[0] for r in self.q("SELECT machine FROM machine_state")), ["C", "V"])
        self.assertEqual(self.q("SELECT cpu, mem_used FROM machine_stats WHERE machine='C'"), [(12.5, 8 * 1024 ** 3)])
        # the same container name on two machines stays two rows
        self.assertEqual(sorted(self.q("SELECT machine, name, mem FROM container_stats")),
                         [("C", "web", 256 * 1024 ** 2), ("V", "web", 256 * 1024 ** 2)])
        self.assertEqual(dict(self.q("SELECT name, status FROM container_state")),
                         {"web": "up", "loop": "down", "0123456789ab": "down"})
        self.assertEqual(dict(self.q("SELECT name, status FROM monitors")),
                         {"site": "down", "queue": "pending", "backup": "maintenance"})
        self.assertEqual(self.q("SELECT uptime24 FROM monitors WHERE name='site'"), [(98.76,)])
        tn = dict(self.q("SELECT name, last_seen FROM tailnet"))
        self.assertEqual(set(tn), {"me", "phone-a", "phone-b"})      # two "localhost" devices both kept
        self.assertIsNone(tn["me"])
        self.assertNotIn("unlisted-box", json.dumps(self.q("SELECT * FROM machine_state")))
        # the Beszel queries really filter what we expect
        stat_q = [q for p, q in Fake.seen if p == "/api/collections/system_stats/records"]
        hist_q = [q for q in stat_q if "type='20m'" in q["filter"][0]]
        now_q = [q for q in stat_q if "type='1m'" in q["filter"][0]]
        self.assertEqual(len(hist_q) + len(now_q), len(stat_q))       # nothing but 20m history and 1m "now"
        self.assertTrue(all("created>'" in q["filter"][0] for q in stat_q))
        self.assertEqual(len(now_q), 2)                                # one latest-1m query per mapped system
        self.assertTrue(all(q["sort"] == ["-created"] and q["perPage"] == ["1"] for q in now_q))
        cur = json.loads(db.get(self.conn, "beszel.now"))
        self.assertEqual(sorted(cur), ["C", "V"])
        self.assertEqual((cur["C"]["cpu"], cur["C"]["mu"], cur["C"]["m"]), (12.5, 8 * 1024 ** 3, 16 * 1024 ** 3))
        self.assertEqual(cur["C"]["t"], "2026-11-17T01:00:00Z")
        cont_q = [q for p, q in Fake.seen if p == "/api/collections/container_stats/records"]
        self.assertTrue(all("type='1m'" in q["filter"][0] and "created>'" in q["filter"][0] for q in cont_q))
        self.assertNotIn(SX, json.dumps(stat_q))                      # unmapped system never queried

    def test_disappeared_things_are_removed(self):
        monitors.collect(self.conn, self.cfg)
        Fake.routes["/api/status-page/lan"] = {"publicGroupList": [{"monitorList": [{"id": 7, "name": "site"}]}]}
        Fake.routes["/containers/json"] = [{"Names": ["/web"], "State": "running"}]
        Fake.routes["/api/collections/systems/records"]["items"] = Fake.routes["/api/collections/systems/records"]["items"][:1]
        monitors.collect(self.conn, self.cfg)
        self.assertEqual([r[0] for r in self.q("SELECT name FROM monitors")], ["site"])
        self.assertEqual([r[0] for r in self.q("SELECT name FROM container_state")], ["web"])
        self.assertEqual([r[0] for r in self.q("SELECT machine FROM machine_state")], ["C"])

    def test_one_failing_source_keeps_its_old_data_and_does_not_stop_others(self):
        monitors.collect(self.conn, self.cfg)
        Fake.fail = {"/api/collections/system_stats/records"}
        Fake.routes["/containers/json"] = [{"Names": ["/new"], "State": "running"}]
        out = monitors.collect(self.conn, self.cfg)
        self.assertIn("error", out["beszel"])
        self.assertNotIn("FAKE", json.dumps(out))                    # no credentials or env names in output
        self.assertEqual(len(self.q("SELECT * FROM machine_state")), 2)   # Beszel data kept, not half-written
        self.assertEqual([r[0] for r in self.q("SELECT name FROM container_state")], ["new"])  # Docker still ran

    def test_redirects_are_not_followed(self):
        with self.assertRaises(Exception):
            monitors._get(self.url + "/redirect", {"Authorization": "tk"})


if __name__ == "__main__":
    unittest.main()
