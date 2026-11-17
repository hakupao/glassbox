"""Build the usage part of a glassbox.probe/1 report from the requests table (CONTRACT §1)."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from . import VERSION, pricing, projects

UTC = timezone.utc


def _hour(ts):
    """'2026-11-16T10:26:09.307Z' (or any offset) -> '2026-11-16T10:00:00Z'."""
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(UTC)
    return dt.strftime("%Y-%m-%dT%H:00:00Z")


def _zulu(dt):
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def usage(conn, machine, days=3, now=None, aliases=None):
    now = (now or datetime.now(UTC)).astimezone(UTC)
    to = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    frm = to - timedelta(days=days)
    # Timestamps are stored as written in the logs (UTC, ISO). Compare with a margin and
    # filter exactly after normalizing.
    lo, hi = _zulu(frm - timedelta(days=1))[:10], _zulu(to + timedelta(days=1))[:10]
    rows = defaultdict(lambda: {"requests": 0, "unpricedRequests": 0, "cost": 0.0, "priced": 0,
                                "tokens": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "reasoning": 0}})
    used = {}
    sql = ("SELECT ts, agent, model, cwd, input, output, cache_read, cache_write5m, cache_write1h, "
           "reasoning, cost FROM requests WHERE ts >= ? AND ts < ?")
    for ts, agent, model, cwd, i, o, cr, w5, w1, rs, cost in conn.execute(sql, (lo, hi + "~")):
        h = _hour(ts)
        if not (_zulu(frm) <= h < _zulu(to)):
            continue
        key, name, remote = projects.resolve(conn, cwd, machine, aliases)
        used[key] = {"name": name, "remote": remote}
        r = rows[(h, agent, model, key)]
        r["requests"] += 1
        t = r["tokens"]
        t["input"] += i; t["output"] += o; t["cacheRead"] += cr; t["cacheWrite"] += w5 + w1; t["reasoning"] += rs
        if cost is None:
            r["unpricedRequests"] += 1
        else:
            r["cost"] += cost
            r["priced"] += 1

    # Sessions: counted once, at the hour of their first request (CONTRACT §1.1). The
    # session owning a request is the earliest-created transcript (see state.UPSERT).
    sessions = defaultdict(int)
    sql = ("SELECT agent, session, MIN(ts), cwd FROM requests WHERE session IS NOT NULL "
           "GROUP BY agent, session")
    for agent, session, first, cwd in conn.execute(sql):
        h = _hour(first)
        if not (_zulu(frm) <= h < _zulu(to)):
            continue
        key, name, remote = projects.resolve(conn, cwd, machine, aliases)
        used[key] = {"name": name, "remote": remote}
        sessions[(h, agent, key)] += 1
    conn.commit()

    out_rows = [{
        "hourStart": h, "agent": a, "model": m, "project": k,
        "requests": r["requests"], "unpricedRequests": r["unpricedRequests"], "tokens": r["tokens"],
        "costUsd": round(r["cost"], 6) if r["priced"] else None,
    } for (h, a, m, k), r in sorted(rows.items())]
    out_sessions = [{"hourStart": h, "agent": a, "project": k, "count": n}
                    for (h, a, k), n in sorted(sessions.items())]
    if any(k == projects.OTHER for k in used) or not used:
        used.setdefault(projects.OTHER, {"name": "other", "remote": None})
    return {
        "usage": {"range": {"from": _zulu(frm), "to": _zulu(to)}, "rows": out_rows, "sessions": out_sessions},
        "projects": used,
    }


def envelope(machine, tz, body):
    return {"schema": "glassbox.probe/1", "machine": machine, "probeVersion": VERSION,
            "pricingVersion": pricing.VERSION, "sentAt": _zulu(datetime.now(UTC)), "tz": tz, **body}
