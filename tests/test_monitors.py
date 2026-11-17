"""Monitor collectors against fake Beszel / Kuma / Docker / tailscaled APIs (fabricated data)."""
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

ROUTES = {
    "/api/collections/users/auth-with-password": {"token": "tk"},
    "/api/collections/systems/records": {"items": [
        {"id": "s1", "name": "home-box", "status": "up", "info": {"u": 3600}},
        {"id": "s2", "name": "unlisted-box", "status": "up", "info": {"u": 1}}]},
    "/api/collections/system_stats/records": {"items": [
        {"created": "2026-11-17 01:00:00.000Z", "stats": {"cpu": 12.5, "m": 16, "mu": 8, "d": 500, "du": 100}}]},
    "/api/collections/container_stats/records": {"items": [{"stats": [{"n": "web", "c": 1.5, "m": 256}]}]},
    "/api/status-page/lan": {"publicGroupList": [{"monitorList": [{"id": 7, "name": "site"}]}]},
    "/api/status-page/heartbeat/lan": {"heartbeatList": {"7": [{"status": 1}, {"status": 0}]}, "uptimeList": {"7_24": 0.9876}},
    "/containers/json": [{"Names": ["/web"], "State": "running"}, {"Names": ["/old"], "State": "exited"}],
    "/localapi/v0/status": {"Self": {"HostName": "me", "OS": "linux", "Online": True, "LastSeen": "0001-01-01T00:00:00Z"},
                            "Peer": {"k": {"HostName": "phone", "OS": "iOS", "Online": False, "LastSeen": "2026-11-17T00:00:00Z"}}},
}


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def address_string(self):
        return "local"

    def _reply(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/collections/") and path != "/api/collections/users/auth-with-password" \
                and self.headers.get("Authorization") != "tk":
            self.send_response(401)
            self.end_headers()
            return
        body = ROUTES.get(path)
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
    def test_all_collectors(self):
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{httpd.server_address[1]}"
        with tempfile.TemporaryDirectory() as d:
            sock = os.path.join(d, "ts.sock")
            ux = UnixServer(sock, Fake)
            threading.Thread(target=ux.serve_forever, daemon=True).start()
            conn = db.connect(Path(d) / "hub.sqlite")
            os.environ["FAKE_BESZEL_PW"] = "pw"
            cfg = {"beszel": {"url": url, "user": "u", "password_env": "FAKE_BESZEL_PW", "map": {"home-box": "C"}},
                   "kuma": {"url": url, "slug": "lan", "machine": "C"},
                   "docker": {"url": url, "machine": "C"},
                   "tailscale": {"socket": sock}}
            out = monitors.collect(conn, cfg)
            self.assertEqual(out["beszel"]["unmapped"], 1)              # unlisted host is skipped, not stored
            self.assertEqual(conn.execute("SELECT machine FROM machine_state").fetchall(), [("C",)])
            cpu, mem_used = conn.execute("SELECT cpu, mem_used FROM machine_stats").fetchone()
            self.assertEqual((cpu, mem_used), (12.5, 8 * 1024 ** 3))
            svc = {r[0]: r[1:] for r in conn.execute("SELECT name, status, cpu, mem, uptime24 FROM services")}
            self.assertEqual(svc["web"][:3], ("up", 1.5, 256 * 1024 * 1024))   # Beszel stats + Docker state
            self.assertEqual(svc["old"][0], "down")
            self.assertEqual(svc["site"][0], "down")                     # last heartbeat wins
            self.assertEqual(svc["site"][3], 98.76)
            tn = dict(conn.execute("SELECT name, last_seen FROM tailnet"))
            self.assertEqual(set(tn), {"me", "phone"})
            self.assertIsNone(tn["me"])                                  # zero time means unknown
            self.assertNotIn("unlisted-box", json.dumps(conn.execute("SELECT * FROM services").fetchall()))
            conn.close()
            ux.shutdown()
            ux.server_close()
        httpd.shutdown()
        httpd.server_close()


if __name__ == "__main__":
    unittest.main()
