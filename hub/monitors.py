"""Machine, service and tailnet status (PLAN §1 "机器与服务"): Beszel, Uptime Kuma, a read-only
Docker API (docker-socket-proxy) and Tailscale. All read-only; credentials come from env vars.

Machine codes: every Beszel system name, Kuma monitor and container is mapped to a machine code
through the config (`[beszel.map]`, `kuma.machine`, `docker.machine`), so real host names stay in
the private store only.
"""
import http.client
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

UTC = timezone.utc
KUMA_STATUS = {0: "down", 1: "up", 2: "unknown", 3: "paused"}
GB = 1024 ** 3


def _get(url, headers=None, data=None, timeout=20):
    h = {"User-Agent": "glassbox-hub", "Accept": "application/json", **(headers or {})}
    if data is not None:
        data = json.dumps(data).encode("utf-8")
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=h, method="POST" if data is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"null")


def _zulu_from_pb(s):
    """PocketBase time '2026-11-17 06:00:00.123Z' -> ISO Z."""
    return datetime.fromisoformat(s.replace(" ", "T").replace("Z", "+00:00")).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _upsert_service(conn, kind, name, machine, **vals):
    conn.execute(
        "INSERT INTO services(kind, name, machine, status, uptime24, cpu, mem, updated) VALUES(?,?,?,?,?,?,?,?) "
        "ON CONFLICT(kind, name) DO UPDATE SET machine=excluded.machine, "
        "status=COALESCE(excluded.status, status), uptime24=COALESCE(excluded.uptime24, uptime24), "
        "cpu=COALESCE(excluded.cpu, cpu), mem=COALESCE(excluded.mem, mem), updated=excluded.updated",
        (kind, name, machine, vals.get("status"), vals.get("uptime24"), vals.get("cpu"), vals.get("mem"), time.time()))


# ------------------------------------------------------------------------------ Beszel
def beszel(conn, cfg):
    b = cfg.get("beszel") or {}
    pw = os.environ.get(b.get("password_env", "BESZEL_PASSWORD"))
    if not b.get("url") or not pw:
        print("beszel: not configured", file=sys.stderr)
        return {}
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
        print("beszel: login failed", file=sys.stderr)
        return {}
    auth = {"Authorization": token}
    mapping = b.get("map", {})
    systems = _get(f"{base}/api/collections/systems/records?perPage=200", auth)["items"]
    since = (datetime.now(UTC) - timedelta(hours=25)).strftime("%Y-%m-%d %H:%M:%S")
    n_points, unmapped, containers = 0, 0, 0
    for s in systems:
        code = mapping.get(s["name"])
        if not code:
            unmapped += 1                       # never store unmapped real host names
            continue
        info = s.get("info") or {}
        conn.execute("INSERT INTO machine_state(machine, status, uptime, updated) VALUES(?,?,?,?) "
                     "ON CONFLICT(machine) DO UPDATE SET status=excluded.status, uptime=excluded.uptime, "
                     "updated=excluded.updated", (code, s.get("status"), info.get("u"), time.time()))
        q = urllib.parse.urlencode({"perPage": 200, "sort": "created",
                                    "filter": f"system='{s['id']}' && type='20m' && created>'{since}'"})
        for rec in _get(f"{base}/api/collections/system_stats/records?{q}", auth)["items"]:
            st = rec.get("stats") or {}
            conn.execute("INSERT OR REPLACE INTO machine_stats VALUES(?,?,?,?,?,?,?)", (
                code, _zulu_from_pb(rec["created"]), st.get("cpu"),
                None if st.get("mu") is None else st["mu"] * GB, None if st.get("m") is None else st["m"] * GB,
                None if st.get("du") is None else st["du"] * GB, None if st.get("d") is None else st["d"] * GB))
            n_points += 1
        q = urllib.parse.urlencode({"perPage": 1, "sort": "-created", "filter": f"system='{s['id']}' && type='1m'"})
        latest = _get(f"{base}/api/collections/container_stats/records?{q}", auth)["items"]
        for c in (latest[0]["stats"] if latest else []):
            _upsert_service(conn, "container", c["n"], code, status=None, cpu=c.get("c"),
                            mem=None if c.get("m") is None else c["m"] * 1024 * 1024)
            containers += 1
    cutoff = (datetime.now(UTC) - timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn.execute("DELETE FROM machine_stats WHERE t < ?", (cutoff,))
    conn.commit()
    return {"systems": len(systems), "unmapped": unmapped, "points": n_points, "containers": containers}


# ------------------------------------------------------------------------------ Uptime Kuma
def kuma(conn, cfg):
    k = cfg.get("kuma") or {}
    if not k.get("url"):
        return {}
    base, slug = k["url"].rstrip("/"), k.get("slug", "default")
    page = _get(f"{base}/api/status-page/{slug}")
    beats = _get(f"{base}/api/status-page/heartbeat/{slug}")
    hb, up = beats.get("heartbeatList") or {}, beats.get("uptimeList") or {}
    n = 0
    for g in page.get("publicGroupList") or []:
        for m in g.get("monitorList") or []:
            mid = str(m["id"])
            last = (hb.get(mid) or [{}])[-1]
            ratio = up.get(f"{mid}_24")
            _upsert_service(conn, "monitor", m["name"], k.get("machine"),
                            status=KUMA_STATUS.get(last.get("status"), "unknown"),
                            uptime24=None if ratio is None else round(ratio * 100, 2))
            n += 1
    conn.commit()
    return {"monitors": n}


# ------------------------------------------------------------------------------ Docker (read-only proxy)
def docker(conn, cfg):
    d = cfg.get("docker") or {}
    if not d.get("url"):
        return {}
    items = _get(d["url"].rstrip("/") + "/containers/json?all=1")
    for c in items:
        name = (c.get("Names") or ["?"])[0].lstrip("/")
        state = {"running": "up", "exited": "down", "dead": "down", "paused": "paused"}.get(c.get("State"), "unknown")
        _upsert_service(conn, "container", name, d.get("machine"), status=state)
    conn.commit()
    return {"containers": len(items)}


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
        c.request("GET", "/localapi/v0/status", headers={"Host": "local-tailscaled.sock"})
        r = c.getresponse()
        return json.loads(r.read())
    out = subprocess.run([t.get("cli", "tailscale"), "status", "--json"], capture_output=True, text=True, timeout=15)
    return json.loads(out.stdout) if out.returncode == 0 else None


def tailscale(conn, cfg):
    t = cfg.get("tailscale") or {}
    if not (t.get("socket") or t.get("cli")):
        return {}
    try:
        st = _tailscale_status(t)
    except (OSError, ValueError, subprocess.TimeoutExpired) as e:
        print(f"tailscale: status failed ({type(e).__name__})", file=sys.stderr)
        return {}
    if not st:
        return {}
    peers = list((st.get("Peer") or {}).values()) + ([st["Self"]] if st.get("Self") else [])
    conn.execute("DELETE FROM tailnet")
    for p in peers:
        name = p.get("HostName") or (p.get("DNSName") or "").split(".")[0]
        last = p.get("LastSeen")
        last = None if not last or last.startswith("0001") else last
        conn.execute("INSERT OR REPLACE INTO tailnet VALUES(?,?,?,?)",
                     (name, (p.get("OS") or "").lower() or None, 1 if p.get("Online") else 0, last))
    conn.commit()
    return {"devices": len(peers)}


def collect(conn, cfg):
    out = {}
    for name, fn in (("beszel", beszel), ("kuma", kuma), ("docker", docker), ("tailscale", tailscale)):
        try:
            out[name] = fn(conn, cfg)
        except (OSError, ValueError, KeyError, urllib.error.HTTPError) as e:
            out[name] = {"error": type(e).__name__}
    return out
