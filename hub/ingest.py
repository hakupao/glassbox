"""Apply one glassbox.probe/1 report to the hub store (CONTRACT §1, §1.1).

Every value is type- and range-checked before it touches the database; anything malformed
raises Rejected (HTTP 400) and the whole report is rolled back.
"""
import hashlib
import math
import sqlite3
import time
from datetime import datetime, timedelta, timezone

UTC = timezone.utc
PROTECT_AFTER = timedelta(days=2)      # hours older than this are protected against shrinking
SHRINK = 0.95
MAX_INT = 2 ** 53
OTHER = "p_other"


class Rejected(Exception):
    """The report is malformed or not allowed; maps to HTTP 400."""


# ---------------------------------------------------------------- value checks
def _int(v, what):
    if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= MAX_INT:
        raise Rejected(f"{what}: expected a non-negative integer")
    return v


def _num(v, what, allow_none=False):
    if v is None and allow_none:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= 1e12:
        raise Rejected(f"{what}: expected a finite non-negative number")
    return float(v)


def _str(v, what, maxlen=200, allow_none=False):
    if v is None and allow_none:
        return None
    if not isinstance(v, str) or len(v) > maxlen:
        raise Rejected(f"{what}: expected a string of at most {maxlen} characters")
    return v


def _dict(v, what):
    if not isinstance(v, dict):
        raise Rejected(f"{what}: expected an object")
    return v


def _list(v, what):
    if not isinstance(v, list):
        raise Rejected(f"{what}: expected a list")
    return v


def _dt(s, what):
    try:
        d = datetime.fromisoformat(_str(s, what, 40).replace("Z", "+00:00"))
    except ValueError:
        raise Rejected(f"{what}: not an ISO time") from None
    if d.tzinfo is None:
        raise Rejected(f"{what}: time without a timezone")
    return d.astimezone(UTC)


def _hour(s, what="hourStart"):
    d = _dt(s, what)
    if d.minute or d.second or d.microsecond:
        raise Rejected(f"{what} not on the hour: {s}")
    return d.strftime("%Y-%m-%dT%H:00:00Z")


def _zulu(s, what):
    return _dt(s, what).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ver(v):
    try:
        return tuple(int(x) for x in str(v).split("+")[0].split("-")[0].split("."))
    except ValueError:
        return (0,)


def project_key(remote):
    return "p_" + hashlib.sha256(remote.encode("utf-8")).hexdigest()[:12]


def warn(conn, machine, kind, detail):
    conn.execute("INSERT INTO warnings(t, machine, kind, detail) VALUES(?,?,?,?)", (time.time(), machine, kind, detail))


# ---------------------------------------------------------------- apply
def apply(conn, machine, rep, now=None):
    """machine is the id bound to the request's token. Returns a summary dict."""
    now = now or datetime.now(UTC)
    if not isinstance(rep, dict):
        raise Rejected("report must be an object")
    if rep.get("schema") != "glassbox.probe/1":
        raise Rejected("schema must be glassbox.probe/1")
    if rep.get("machine") != machine:
        raise Rejected("machine does not match the token")
    m = conn.execute("SELECT probe_version, rebaseline_until FROM machines WHERE id=?", (machine,)).fetchone()
    prev_version, rebase_until = (m or (None, None))
    summary = {"rows": 0, "kept_hours": 0}
    try:
        with conn:
            projects = _projects(conn, machine, _dict(rep.get("projects") or {}, "projects"))
            known = lambda k: k in projects or conn.execute("SELECT 1 FROM projects WHERE key=?", (k,)).fetchone()
            if "usage" in rep:
                summary.update(_usage(conn, machine, rep, now, prev_version, rebase_until, known))
            for i, q in enumerate(_list(rep.get("quota") or [], "quota")):
                q = _dict(q, f"quota[{i}]")
                conn.execute("INSERT OR IGNORE INTO quota(account, agent, window, sampled_at, used_pct, resets_at, machine) "
                             "VALUES(?,?,?,?,?,?,?)", (
                                 _str(q["account"], "account", 40), _agent(q["agent"]), _window(q["window"]),
                                 _zulu(q["sampledAt"], "sampledAt"), _num(q["usedPct"], "usedPct"),
                                 _zulu(q["resetsAt"], "resetsAt"), machine))
            if "runtimes" in rep:
                rts = [_dict(r, "runtime") for r in _list(rep["runtimes"], "runtimes")]
                conn.execute("DELETE FROM runtimes WHERE machine=?", (machine,))
                conn.executemany("INSERT OR REPLACE INTO runtimes VALUES(?,?,?,?,?,?)", [
                    (machine, _agent(r["agent"]), _str(r.get("version"), "version", 40, True),
                     _int(r.get("processes", 0), "processes"), _int(r.get("activeSessions", 0), "activeSessions"),
                     time.time()) for r in rts])
            if "jobs" in rep:
                js = [_dict(j, "job") for j in _list(rep["jobs"], "jobs")]
                conn.execute("DELETE FROM jobs WHERE machine=?", (machine,))
                conn.executemany("INSERT OR REPLACE INTO jobs VALUES(?,?,?,?,?,?)", [
                    (machine, _str(j["name"], "job name", 80),
                     None if j.get("lastRun") is None else _zulu(j["lastRun"], "lastRun"),
                     None if j.get("lastSuccess") is None else _zulu(j["lastSuccess"], "lastSuccess"),
                     1 if j.get("ok") is True else 0, time.time()) for j in js])
            for gi, g in enumerate(_list(rep.get("git") or [], "git")):
                g = _dict(g, f"git[{gi}]")
                key = _str(g["project"], "project", 40)
                if not known(key):
                    raise Rejected(f"git references undeclared project {key}")
                name, remote = conn.execute("SELECT name, remote FROM projects WHERE key=?", (key,)).fetchone()
                rows = []
                for c in _list(g.get("commits", []), "commits"):
                    c = _dict(c, "commit")
                    rows.append((_str(c["hash"], "hash", 40), _zulu(c["t"], "t"), name, remote, key,
                                 _str(c.get("branch"), "branch", 200, True), _str(c.get("title", ""), "title", 500),
                                 machine, 1 if c.get("pushed") is True else 0))
                conn.execute("DELETE FROM commits WHERE source='local' AND machine=? AND project=?", (machine, key))
                conn.executemany(
                    "INSERT OR REPLACE INTO commits(source, hash, machine, t, repo, remote, project, branch, title, url, pushed, private) "
                    "VALUES('local',?,?,?,?,?,?,?,?,NULL,?,NULL)",
                    [(h, mach, t, n, r, k, b, ti, p) for h, t, n, r, k, b, ti, mach, p in rows])
            conn.execute("INSERT INTO machines(id, last_report, probe_version) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET "
                         "last_report=excluded.last_report, probe_version=excluded.probe_version",
                         (machine, time.time(), _str(rep.get("probeVersion"), "probeVersion", 40, True)))
    except Rejected:
        raise
    except (KeyError, TypeError, ValueError, AttributeError, OverflowError, sqlite3.Error) as e:
        raise Rejected(f"malformed report ({type(e).__name__})") from None
    return summary


def _agent(v):
    if v not in ("claude-code", "codex"):
        raise Rejected("agent must be claude-code or codex")
    return v


def _window(v):
    if v not in ("5h", "7d"):
        raise Rejected("window must be 5h or 7d")
    return v


def _projects(conn, machine, projects):
    """Declare projects. A key with a remote must be the hash of that remote, so a machine cannot
    relabel someone else's project; a remote-less key belongs to the machine that first reported it."""
    for key, p in projects.items():
        _str(key, "project key", 40)
        p = _dict(p, f"projects[{key}]")
        name = _str(p.get("name"), "project name", 200, True)
        remote = _str(p.get("remote"), "remote", 300, True)
        if key == OTHER:
            remote = None
        elif remote is not None:
            if remote != remote.lower() or project_key(remote) != key:
                raise Rejected(f"project key {key} does not match its remote")
        old = conn.execute("SELECT remote, owner FROM projects WHERE key=?", (key,)).fetchone()
        if old and remote is None and key != OTHER and old[1] not in (None, machine):
            raise Rejected(f"project {key} belongs to another machine")
        conn.execute(
            "INSERT INTO projects(key, name, remote, owner) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET "
            "name=excluded.name, remote=excluded.remote, "
            "visibility=CASE WHEN projects.remote IS excluded.remote THEN visibility ELSE NULL END, "
            "checked=CASE WHEN projects.remote IS excluded.remote THEN checked ELSE NULL END",
            (key, name, remote, None if remote else machine))
    return projects


def _usage(conn, machine, rep, now, prev_version, rebase_until, known):
    u = _dict(rep["usage"], "usage")
    rng = _dict(u["range"], "usage.range")
    lo, hi = _hour(rng["from"], "range.from"), _hour(rng["to"], "range.to")
    if lo >= hi or (_dt(hi, "to") - _dt(lo, "from")) > timedelta(days=40):
        raise Rejected("bad usage range")
    if _dt(hi, "to") > now + timedelta(hours=2):
        raise Rejected("usage range reaches into the future")

    # Aggregate rows / sessions that share a key (CONTRACT keys must be unique; summing is the
    # safe reading if a probe repeats one).
    agg = {}
    for i, r in enumerate(_list(u.get("rows", []), "rows")):
        r = _dict(r, f"rows[{i}]")
        h, p = _hour(r["hourStart"]), _str(r["project"], "project", 40)
        if not (lo <= h < hi):
            raise Rejected(f"hourStart {h} outside the declared range")
        if not known(p):
            raise Rejected(f"usage references undeclared project {p}")
        t = _dict(r["tokens"], "tokens")
        k = (h, _agent(r["agent"]), _str(r["model"], "model", 80), p)
        vals = [_int(r["requests"], "requests"), _int(r.get("unpricedRequests", 0), "unpricedRequests"),
                _int(t["input"], "input"), _int(t["output"], "output"), _int(t["cacheRead"], "cacheRead"),
                _int(t["cacheWrite"], "cacheWrite"), _int(t.get("reasoning", 0), "reasoning"),
                _num(r.get("costUsd"), "costUsd", allow_none=True)]
        if k in agg:
            old = agg[k]
            vals = [a + b for a, b in zip(old[:7], vals[:7])] + [
                None if old[7] is None and vals[7] is None else (old[7] or 0) + (vals[7] or 0)]
        agg[k] = vals
    sess = {}
    for i, s in enumerate(_list(u.get("sessions", []), "sessions")):
        s = _dict(s, f"sessions[{i}]")
        h, p = _hour(s["hourStart"]), _str(s["project"], "project", 40)
        if not (lo <= h < hi):
            raise Rejected(f"session hourStart {h} outside the declared range")
        if not known(p):
            raise Rejected(f"sessions reference undeclared project {p}")
        k = (h, _agent(s["agent"]), p)
        sess[k] = sess.get(k, 0) + _int(s["count"], "count")

    asked = u.get("rebaseline") is True
    newer = bool(prev_version) and _ver(rep.get("probeVersion")) > _ver(prev_version)
    rebaseline = asked and (newer or (rebase_until or 0) > time.time())
    if asked and not rebaseline:
        warn(conn, machine, "rebaseline-refused", "needs a newer probe version or `hub machine rebaseline`")

    # Per-hour anti-shrink for protected hours (CONTRACT §1.1).
    new_req = {}
    for (h, *_), v in agg.items():
        new_req[h] = new_req.get(h, 0) + v[0]
    old_req = dict(conn.execute("SELECT hour, SUM(requests) FROM usage WHERE machine=? AND hour>=? AND hour<? GROUP BY hour",
                                (machine, lo, hi)))
    protect_before = (now - PROTECT_AFTER).strftime("%Y-%m-%dT%H:00:00Z")
    keep = set()
    if not rebaseline:
        for h, old in old_req.items():
            if h < protect_before and new_req.get(h, 0) < old * SHRINK:
                keep.add(h)
                warn(conn, machine, "shrink", f"{h}: kept {old} requests, report had {new_req.get(h, 0)}")

    marks = ",".join("?" * len(keep))
    conn.execute(f"DELETE FROM usage WHERE machine=? AND hour>=? AND hour<? AND hour NOT IN ({marks})", (machine, lo, hi, *keep))
    conn.execute(f"DELETE FROM sessions WHERE machine=? AND hour>=? AND hour<? AND hour NOT IN ({marks})", (machine, lo, hi, *keep))
    ins = [(machine, *k, *v) for k, v in agg.items() if k[0] not in keep]
    conn.executemany("INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", ins)
    conn.executemany("INSERT INTO sessions VALUES(?,?,?,?,?)", [(machine, *k, n) for k, n in sess.items() if k[0] not in keep])
    if rebaseline:
        conn.execute("UPDATE machines SET rebaseline_until=NULL WHERE id=?", (machine,))
    return {"rows": len(ins), "kept_hours": len(keep), "rebaseline": rebaseline,
            **({"rebaselineRefused": True} if asked and not rebaseline else {})}
