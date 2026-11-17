"""HTTP server. Binds to 127.0.0.1 by default; on the deploy machine `tailscale serve`
in the sidecar container is the only way in (PLAN §2)."""
import gzip
import hashlib
import hmac
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import ingest

MAX_BODY = 32 * 1024 * 1024


def token_sha(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class Hub:
    def __init__(self, conn):
        self.conn = conn
        self.lock = threading.Lock()

    def machine_for(self, auth):
        if not auth or not auth.startswith("Bearer "):
            return None
        sha = token_sha(auth[7:].strip())
        for mid, known in self.conn.execute("SELECT id, token_sha FROM machines WHERE token_sha IS NOT NULL"):
            if hmac.compare_digest(sha, known):
                return mid
        return None


def make_handler(hub):
    class Handler(BaseHTTPRequestHandler):
        server_version = "glassbox"
        sys_version = ""

        def _send(self, code, obj):
            body = json.dumps(obj).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt, *args):      # no request lines with client addresses in logs
            pass

        def do_GET(self):
            if self.path == "/healthz":
                return self._send(200, {"ok": True})
            return self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/ingest":
                return self._send(404, {"error": "not found"})
            with hub.lock:
                machine = hub.machine_for(self.headers.get("Authorization"))
            if not machine:
                return self._send(401, {"error": "bad token"})
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > MAX_BODY:
                return self._send(413, {"error": "body size"})
            raw = self.rfile.read(n)
            try:
                if self.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                rep = json.loads(raw)
            except (OSError, ValueError):
                return self._send(400, {"error": "not JSON"})
            try:
                with hub.lock:
                    summary = ingest.apply(hub.conn, machine, rep)
            except ingest.Rejected as e:
                return self._send(400, {"error": str(e)})
            return self._send(200, {"ok": True, **summary})

    return Handler


def serve(conn, host="127.0.0.1", port=8787):
    httpd = ThreadingHTTPServer((host, port), make_handler(Hub(conn)))
    httpd.daemon_threads = True
    print(f"glassbox hub listening on http://{host}:{port}/", flush=True)
    httpd.serve_forever()
