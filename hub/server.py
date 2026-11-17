"""HTTP server. Binds to 127.0.0.1 by default; on the deploy machine `tailscale serve`
in the sidecar container is the only way in (PLAN §2)."""
import hashlib
import hmac
import json
import sys
import threading
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import ingest, page

MAX_BODY = 8 * 1024 * 1024          # compressed request body
MAX_JSON = 64 * 1024 * 1024          # after gzip; a normal report is well under 1 MB


LOOPBACK = frozenset({"127.0.0.1", "localhost", "::1"})


class TooLarge(Exception):
    pass


def serve_hosts(cfg):
    """[serve] hosts as a set of lower-case names. A bare string is a config error: iterating it
    would allow single characters as Host names."""
    hosts = ((cfg or {}).get("serve") or {}).get("hosts", [])
    if not isinstance(hosts, list) or not all(isinstance(h, str) and h.strip() for h in hosts):
        raise ValueError('[serve] hosts must be a list of names, e.g. hosts = ["glassbox.<tailnet>.ts.net"]')
    return {h.strip().lower() for h in hosts}


def gunzip_bounded(raw, limit=MAX_JSON):
    """Decompress gzip without trusting the ratio (gzip bombs)."""
    d = zlib.decompressobj(wbits=31)
    out, chunk = [], raw
    size = 0
    while chunk:
        part = d.decompress(chunk, limit + 1 - size)
        size += len(part)
        out.append(part)
        if size > limit:
            raise TooLarge()
        chunk = d.unconsumed_tail
    if not d.eof:
        raise ValueError("truncated gzip")
    return b"".join(out)


def token_sha(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class Hub:
    def __init__(self, conn, cfg=None):
        self.conn = conn
        self.cfg = cfg
        self.lock = threading.Lock()
        # Host names the private view answers to (DNS rebinding): loopback plus [serve] hosts,
        # e.g. the tailnet name that `tailscale serve` forwards with.
        self.hosts = LOOPBACK | serve_hosts(cfg)

    def host_ok(self, header):
        """True when the Host header (port ignored) is an allowed name."""
        h = (header or "").strip().lower()
        if h.startswith("["):
            h = h[1:].split("]", 1)[0]
        elif h.count(":") == 1:
            h = h.split(":", 1)[0]
        return h in self.hosts

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
        timeout = 30                              # slow or stalled clients

        def _send(self, code, obj, ctype="application/json"):
            body = obj.encode("utf-8") if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype + "; charset=utf-8")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(body)))
            if code == 200 and self.command == "GET":
                self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt, *args):      # no request lines with client addresses in logs
            pass

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/healthz":
                return self._send(200, {"ok": True})
            if path == "/favicon.ico":
                self.send_response(204)
                self.end_headers()
                return
            if path in ("/", "/index.html", "/page.json") and hub.cfg is not None:
                # The private view (PLAN §2): reachable only where the hub listens (loopback / tailnet),
                # and only under a known Host name, so a rebinding DNS name cannot read it.
                # /ingest needs no such check: it takes a bearer token, never a cookie or ambient auth.
                if not hub.host_ok(self.headers.get("Host")):
                    return self._send(421, {"error": "unknown host"})
                try:
                    with hub.lock:
                        data = page.build(hub.conn, hub.cfg)
                    if path == "/page.json":
                        return self._send(200, data)
                    # One self-contained document (web/ inlined, CSP: inline only), same as the public snapshot.
                    return self._send(200, page.bundle(data), "text/html")
                except Exception as e:            # never echo data
                    print(f"page error: {type(e).__name__}", file=sys.stderr, flush=True)
                    return self._send(500, {"error": "internal error"})
            return self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/ingest":
                return self._send(404, {"error": "not found"})
            with hub.lock:
                machine = hub.machine_for(self.headers.get("Authorization"))
            if not machine:
                return self._send(401, {"error": "bad token"})
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return self._send(400, {"error": "bad Content-Length"})
            if n <= 0 or n > MAX_BODY:
                return self._send(413, {"error": "body size"})
            raw = self.rfile.read(n)
            try:
                if self.headers.get("Content-Encoding") == "gzip":
                    raw = gunzip_bounded(raw)
                elif len(raw) > MAX_JSON:
                    raise TooLarge()
                rep = json.loads(raw)
            except TooLarge:
                return self._send(413, {"error": "report too large"})
            except (zlib.error, ValueError, RecursionError):
                return self._send(400, {"error": "not JSON"})
            try:
                with hub.lock:
                    summary = ingest.apply(hub.conn, machine, rep)
            except ingest.Rejected as e:
                return self._send(400, {"error": str(e)})
            except Exception as e:            # never echo data; one line, no traceback with values
                print(f"ingest error from {machine}: {type(e).__name__}", file=sys.stderr, flush=True)
                return self._send(500, {"error": "internal error"})
            return self._send(200, {"ok": True, **summary})

    return Handler


def serve(conn, host="127.0.0.1", port=8787, cfg=None):
    httpd = ThreadingHTTPServer((host, port), make_handler(Hub(conn, cfg)))
    httpd.daemon_threads = True
    print(f"glassbox hub listening on http://{host}:{port}/", flush=True)
    httpd.serve_forever()
