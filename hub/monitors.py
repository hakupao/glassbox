"""Machine, service and tailnet status (PLAN §1 "机器与服务"): Beszel, Uptime Kuma, a read-only
Docker API (docker-socket-proxy) and Tailscale. All read-only; credentials come from env vars.

Each source owns its own table and replaces it completely after a successful run, so things that
disappear (a removed container, a renamed monitor, an unmapped system) disappear here too. A
failing source is rolled back and leaves its previous data; it never stops the other sources.

Machine codes: Beszel systems are kept only when `[beszel.map]` gives them a code, so real host
names of unmapped systems never enter the store. Service, monitor and tailnet names are stored
as-is in this private store; the public export masks them (CONTRACT §3; S10/S11 acceptance).

History: Beszel's 20-minute buckets for the last 25 hours (the page shows 24 hours).
"""
import http.client
import json
import os
import re
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

UTC = timezone.utc
GIB, MIB = 1024 ** 3, 1024 ** 2
KUMA_STATUS = {0: "down", 1: "up", 2: "pending", 3: "maintenance"}
DOCKER_STATE = {"running": "up", "exited": "down", "dead": "down", "restarting": "down", "paused": "paused",
                "created": "unknown", "removing": "unknown"}
PB_ID = re.compile(r"[a-z0-9]{15}")
FRESH = timedelta(minutes=5)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow redirects: they would carry the Authorization header to another host."""

    def redirect_request(self, *a, **k):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def _get(url, headers=None, data=None, timeout=20):
    h = {"User-Agent": "glassbox-hub", "Accept": "application/json", **(headers or {})}
    if data is not None:
        data = json.dumps(data).encode("utf-8")
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=h, method="POST" if data is not None else "GET")
    with _OPENER.open(req, timeout=timeout) as r:
        body = json.loads(r.read() or b"null")
    if body is None:
        raise ValueError("empty response")
    return body


def _pb_time(dt):
    return dt.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S")


def _zulu_from_pb(s):
    """PocketBase time '2026-11-17 06:00:00.123Z' -> ISO Z."""
    return datetime.fromisoformat(s.replace(" ", "T").replace("Z", "+00:00")).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _pb_list(base, coll, auth, **params):
    """All records of a PocketBase collection query, following pagination."""
    page, out = 1, []
    while True:
        q = urllib.parse.urlencode({"perPage": 200, "page": page, **params})
        res = _get(f"{base}/api/collections/{coll}/records?{q}", auth)
        out += res.get("items") or []
        total = int(res.get("totalPages") or 1)
        if page >= total:
            return out
        if page >= 50:
            raise OverflowError(f"{coll}: more than 50 pages")   # fail loudly rather than truncate
        page += 1


# ------------------------------------------------------------------------------ Beszel
def beszel(conn, cfg):
    b = cfg.get("beszel") or {}
    pw = os.environ.get(b.get("password_env", "BESZEL_PASSWORD"))
    if not b.get("url") or not pw:
        return {"skipped": "not configured"}
    base = b["url"].rstrip("/")
    token = None
    for coll in ("users", "_superusers"):
        try:
            token = _get(f"{base}/api/collections/{coll}/auth-with-password",
                         data={"identity": b["user"], "password": pw})["token"]
            break
        except urllib.error.HTTPError:
            continue
    if not token:
        raise PermissionError("beszel login failed")
    auth = {"Authorization": token}
    mapping = b.get("map", {})
    now = datetime.now(UTC)
    since = _pb_time(now - timedelta(hours=25))
    state, stats, containers, unmapped = [], [], [], 0
    for s in _pb_list(base, "systems", auth):
        code = mapping.get(s.get("name"))
        if not code or not PB_ID.fullmatch(str(s.get("id"))):
            unmapped += 1                       # never store unmapped real host names
            continue
        info = s.get("info") or {}
        state.append((code, s.get("status"), info.get("u"), time.time()))
        for rec in _pb_list(base, "system_stats", auth, sort="created",
                            filter=f"system='{s['id']}' && type='20m' && created>'{since}'"):
            st = rec.get("stats") or {}
            g = lambda k: None if st.get(k) is None else st[k] * GIB
            stats.append((code, _zulu_from_pb(rec["created"]), st.get("cpu"), g("mu"), g("m"), g("du"), g("d")))
        latest = _get(f"{base}/api/collections/container_stats/records?" + urllib.parse.urlencode({
            "perPage": 1, "sort": "-created",
            "filter": f"system='{s['id']}' && type='1m' && created>'{_pb_time(now - FRESH)}'"}), auth).get("items") or []
        for c in (latest[0].get("stats") or []) if latest else []:
            if c.get("n"):
                containers.append((code, c["n"], c.get("c"), None if c.get("m") is None else c["m"] * MIB))
    with conn:
        conn.execute("DELETE FROM machine_state")
        conn.executemany("INSERT INTO machine_state VALUES(?,?,?,?)", state)
        conn.execute("DELETE FROM machine_stats")
        conn.executemany("INSERT OR REPLACE INTO machine_stats VALUES(?,?,?,?,?,?,?)", stats)
        conn.execute("DELETE FROM container_stats")
        conn.executemany("INSERT OR REPLACE INTO container_stats VALUES(?,?,?,?)", containers)
    return {"systems": len(state), "unmapped": unmapped, "points": len(stats), "containers": len(containers)}


# ------------------------------------------------------------------------------ Uptime Kuma
def kuma(conn, cfg):
    k = cfg.get("kuma") or {}
    if not k.get("url"):
        return {"skipped": "not configured"}
    base, slug = k["url"].rstrip("/"), urllib.parse.quote(k.get("slug", "default"), safe="")
    page = _get(f"{base}/api/status-page/{slug}")
    beats = _get(f"{base}/api/status-page/heartbeat/{slug}")
    hb, up = beats.get("heartbeatList") or {}, beats.get("uptimeList") or {}
    rows = []
    for g in page.get("publicGroupList") or []:
        for m in g.get("monitorList") or []:
            mid = str(m["id"])
            last = (hb.get(mid) or [{}])[-1]
            ratio = up.get(f"{mid}_24")
            rows.append((mid, m.get("name") or mid, k.get("machine"), KUMA_STATUS.get(last.get("status"), "unknown"),
                         None if ratio is None else round(ratio * 100, 2)))
    with conn:
        conn.execute("DELETE FROM monitors")
        conn.executemany("INSERT OR REPLACE INTO monitors VALUES(?,?,?,?,?)", rows)
    return {"monitors": len(rows)}


# ------------------------------------------------------------------------------ Docker (read-only proxy)
def docker(conn, cfg):
    d = cfg.get("docker") or {}
    if not d.get("url") or not d.get("machine"):
        return {"skipped": "not configured (needs url and machine)"}
    rows = []
    for c in _get(d["url"].rstrip("/") + "/containers/json?all=1"):
        name = ((c.get("Names") or [None])[0] or "").lstrip("/") or str(c.get("Id", ""))[:12] or "?"
        rows.append((d["machine"], name, DOCKER_STATE.get(c.get("State"), "unknown")))
    with conn:
        conn.execute("DELETE FROM container_state WHERE machine=?", (d["machine"],))
        conn.executemany("INSERT OR REPLACE INTO container_state VALUES(?,?,?)", rows)
    return {"containers": len(rows)}


# ------------------------------------------------------------------------------ Tailscale
class _UnixHTTP(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__("local-tailscaled.sock", timeout=10)
        self._path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(10)
        self.sock.connect(self._path)


def _tailscale_status(t):
    if t.get("socket"):
        c = _UnixHTTP(t["socket"])
        try:
            c.request("GET", "/localapi/v0/status", headers={"Host": "local-tailscaled.sock"})
            r = c.getresponse()
            body = r.read()
            if r.status != 200:
                raise PermissionError(f"tailscaled answered HTTP {r.status}")
            return json.loads(body)
        finally:
            c.close()
    out = subprocess.run([t.get("cli", "tailscale"), "status", "--json"], capture_output=True, text=True, timeout=15)
    if out.returncode != 0:
        raise RuntimeError("tailscale status failed")
    return json.loads(out.stdout)


def tailscale(conn, cfg):
    t = cfg.get("tailscale") or {}
    if not (t.get("socket") or t.get("cli")):
        return {"skipped": "not configured"}
    st = _tailscale_status(t)
    peers = list((st.get("Peer") or {}).values()) + ([st["Self"]] if st.get("Self") else [])
    rows = {}
    for p in peers:
        name = ((p.get("DNSName") or "").split(".")[0] or p.get("HostName")
                or "device-" + str(p.get("ID") or p.get("PublicKey") or len(rows))[-6:])   # DNS name is unique per tailnet
        last = p.get("LastSeen")
        rows[name] = (name, (p.get("OS") or "").lower() or None, 1 if p.get("Online") else 0,
                      None if not last or last.startswith("0001") else last)
    with conn:
        conn.execute("DELETE FROM tailnet")
        conn.executemany("INSERT INTO tailnet VALUES(?,?,?,?)", list(rows.values()))
    return {"devices": len(rows)}


def collect(conn, cfg):
    out = {}
    for name, fn in (("beszel", beszel), ("kuma", kuma), ("docker", docker), ("tailscale", tailscale)):
        try:
            out[name] = fn(conn, cfg)
        except Exception as e:                     # one source never stops the others
            conn.rollback()
            out[name] = {"error": type(e).__name__}
    return out
