"""Apply one glassbox.probe/1 report to the hub store (CONTRACT §1, §1.1)."""
import time
from datetime import datetime, timedelta, timezone

UTC = timezone.utc
PROTECT_AFTER = timedelta(days=2)      # hours older than this are protected against shrinking
SHRINK = 0.95


class Rejected(Exception):
    """The report is malformed or not allowed; maps to HTTP 400."""


def _dt(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(UTC)


def _hour(s):
    d = _dt(s)
    if d.minute or d.second or d.microsecond:
        raise Rejected(f"hourStart not on the hour: {s}")
    return d.strftime("%Y-%m-%dT%H:00:00Z")


def _ver(v):
    try:
        return tuple(int(x) for x in str(v).split("+")[0].split("-")[0].split("."))
    except ValueError:
        return (0,)


def warn(conn, machine, kind, detail):
    conn.execute("INSERT INTO warnings(t, machine, kind, detail) VALUES(?,?,?,?)", (time.time(), machine, kind, detail))


def apply(conn, machine, rep, now=None):
    """machine is the id bound to the request's token. Returns a summary dict."""
    now = now or datetime.now(UTC)
    if rep.get("schema") != "glassbox.probe/1":
        raise Rejected("schema must be glassbox.probe/1")
    if rep.get("machine") != machine:
        raise Rejected("machine does not match the token")
    m = conn.execute("SELECT probe_version, rebaseline_until FROM machines WHERE id=?", (machine,)).fetchone()
    prev_version, rebase_until = (m or (None, None))
    summary = {"rows": 0, "kept_hours": 0}
    projects = rep.get("projects") or {}
    try:
        with conn:
            for key, p in projects.items():
                conn.execute(
                    "INSERT INTO projects(key, name, remote) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET "
                    "name=excluded.name, remote=excluded.remote", (key, p.get("name"), p.get("remote")))
            if "usage" in rep:
                summary.update(_usage(conn, machine, rep, now, prev_version, rebase_until, set(projects)))
            for q in rep.get("quota") or []:
                conn.execute("INSERT OR IGNORE INTO quota(account, agent, window, sampled_at, used_pct, resets_at, machine) "
                             "VALUES(?,?,?,?,?,?,?)", (q["account"], q["agent"], q["window"], q["sampledAt"],
                                                        float(q["usedPct"]), q["resetsAt"], machine))
            if "runtimes" in rep:
                conn.execute("DELETE FROM runtimes WHERE machine=?", (machine,))
                conn.executemany("INSERT INTO runtimes VALUES(?,?,?,?,?,?)", [
                    (machine, r["agent"], r.get("version"), r.get("processes", 0), r.get("activeSessions", 0), time.time())
                    for r in rep["runtimes"]])
            if "jobs" in rep:
                conn.execute("DELETE FROM jobs WHERE machine=?", (machine,))
                conn.executemany("INSERT INTO jobs VALUES(?,?,?,?,?,?)", [
                    (machine, j["name"], j.get("lastRun"), j.get("lastSuccess"), 1 if j.get("ok") else 0, time.time())
                    for j in rep["jobs"]])
            for g in rep.get("git") or []:
                key = g["project"]
                if key not in projects and not conn.execute("SELECT 1 FROM projects WHERE key=?", (key,)).fetchone():
                    raise Rejected(f"git references undeclared project {key}")
                remote = (projects.get(key) or {}).get("remote")
                name = (projects.get(key) or {}).get("name")
                conn.execute("DELETE FROM commits WHERE source='local' AND machine=? AND project=?", (machine, key))
                conn.executemany(
                    "INSERT OR REPLACE INTO commits(source, hash, t, repo, remote, project, branch, title, url, machine, pushed, private) "
                    "VALUES('local',?,?,?,?,?,?,?,NULL,?,?,NULL)",
                    [(c["hash"], c["t"], name, remote, key, c.get("branch"), c.get("title", ""), machine,
                      1 if c.get("pushed") else 0) for c in g.get("commits", [])])
            conn.execute("INSERT INTO machines(id, last_report, probe_version) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET "
                         "last_report=excluded.last_report, probe_version=excluded.probe_version",
                         (machine, time.time(), rep.get("probeVersion")))
    except (KeyError, TypeError, ValueError) as e:
        raise Rejected(f"malformed report: {e!r}") from None
    return summary


def _usage(conn, machine, rep, now, prev_version, rebase_until, declared):
    u = rep["usage"]
    frm, to = _dt(u["range"]["from"]), _dt(u["range"]["to"])
    if frm >= to or (to - frm) > timedelta(days=40):
        raise Rejected("bad usage range")
    lo, hi = frm.strftime("%Y-%m-%dT%H:00:00Z"), to.strftime("%Y-%m-%dT%H:00:00Z")
    rows, sess = u.get("rows", []), u.get("sessions", [])
    for r in rows + sess:
        if r["project"] not in declared and not conn.execute("SELECT 1 FROM projects WHERE key=?", (r["project"],)).fetchone():
            raise Rejected(f"usage references undeclared project {r['project']}")
        h = _hour(r["hourStart"])
        if not (lo <= h < hi):
            raise Rejected(f"hourStart {h} outside the declared range")

    rebaseline = bool(u.get("rebaseline")) and (
        (prev_version and _ver(rep.get("probeVersion")) > _ver(prev_version)) or (rebase_until or 0) > time.time())

    # Per-hour anti-shrink for protected hours (CONTRACT §1.1).
    new_req = {}
    for r in rows:
        new_req[_hour(r["hourStart"])] = new_req.get(_hour(r["hourStart"]), 0) + int(r["requests"])
    old_req = dict(conn.execute("SELECT hour, SUM(requests) FROM usage WHERE machine=? AND hour>=? AND hour<? GROUP BY hour",
                                (machine, lo, hi)))
    protect_before = (now - PROTECT_AFTER).strftime("%Y-%m-%dT%H:00:00Z")
    keep = set()
    if not rebaseline:
        for h, old in old_req.items():
            if h < protect_before and new_req.get(h, 0) < old * SHRINK:
                keep.add(h)
                warn(conn, machine, "shrink", f"{h}: kept {old} requests, report had {new_req.get(h, 0)}")

    conn.execute(f"DELETE FROM usage WHERE machine=? AND hour>=? AND hour<? AND hour NOT IN ({','.join('?' * len(keep))})",
                 (machine, lo, hi, *keep))
    conn.execute(f"DELETE FROM sessions WHERE machine=? AND hour>=? AND hour<? AND hour NOT IN ({','.join('?' * len(keep))})",
                 (machine, lo, hi, *keep))
    ins = []
    for r in rows:
        h = _hour(r["hourStart"])
        if h in keep:
            continue
        t = r["tokens"]
        ins.append((machine, h, r["agent"], r["model"], r["project"], int(r["requests"]), int(r.get("unpricedRequests", 0)),
                    int(t["input"]), int(t["output"]), int(t["cacheRead"]), int(t["cacheWrite"]), int(t.get("reasoning", 0)),
                    None if r.get("costUsd") is None else float(r["costUsd"])))
    conn.executemany("INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", ins)
    conn.executemany("INSERT INTO sessions VALUES(?,?,?,?,?) ON CONFLICT DO UPDATE SET count=excluded.count", [
        (machine, _hour(s["hourStart"]), s["agent"], s["project"], int(s["count"])) for s in sess
        if _hour(s["hourStart"]) not in keep])
    if rebaseline:
        conn.execute("UPDATE machines SET rebaseline_until=NULL WHERE id=?", (machine,))
    return {"rows": len(ins), "kept_hours": len(keep), "rebaseline": rebaseline}
