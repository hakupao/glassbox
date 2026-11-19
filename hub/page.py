"""Build glassbox.page/1 (view=private) from the hub store (CONTRACT §2, §2.1).

Days and hours are cut here, in the hub's time zone, and nowhere else (CONTRACT §0). Usage is
stored in UTC hours, so the zone must have a whole-hour offset.

The private page shows names as stored. The public snapshot is rebuilt from this by the exporter
(CONTRACT §3), which masks or drops everything not on its allowlist; fields marked provisional in
CONTRACT §2.2 are not on it.

Optional hub config used here:
    tz = "Asia/Tokyo"
    [accounts]          "a_1f2e3d4c" = "K"           # quota account hash -> code
    [machines.C]        role = "deploy", os = "macos", label = "..."   # machines not registered by a probe
    [services.merge]    "<monitor name>" = "<container name>"          # when the names differ
"""
import json
import re
from pathlib import Path
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from probe import pricing

from . import db

UTC = timezone.utc
AGENTS = ("claude-code", "codex")
STALE = 15 * 60                       # seconds without a probe report before runtimes go grey
TREND_DAYS = 30
DETAIL_DAYS = 90                      # usageDays and code.commits
ACTIVITY_MAX = 50
CODE_COMMITS_MAX = 500
SOURCE_RANK = {"github": 0, "gitea": 1, "local": 2}
WINDOW = {"5h": timedelta(hours=5), "7d": timedelta(days=7)}
STATUS_RANK = {"down": 0, "paused": 1, "pending": 2, "maintenance": 3, "unknown": 4, "up": 5}


def zone(cfg, now):
    """The hub zone; every offset it uses in the year around now must be a whole hour (a DST
    switch can bring a half-hour offset, as in Australia/Lord_Howe). Offsets hold for weeks at a
    time, so a daily sample finds every one of them."""
    tz = ZoneInfo(cfg.get("tz", "Asia/Tokyo"))
    for d in range(-183, 184):
        if (now + timedelta(days=d)).astimezone(tz).utcoffset().total_seconds() % 3600:
            raise ValueError(f"hub tz {cfg.get('tz')} is not a whole-hour offset (usage is stored in UTC hours)")
    return tz


def _parse(v):
    """Epoch seconds or ISO text -> aware datetime (None stays None)."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v, UTC)
    return datetime.fromisoformat(v.replace("Z", "+00:00"))


def _r(x):
    return round(x, 6)


def _tok():
    return {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "reasoning": 0}


class _Acc:
    """Running totals for one bucket. cost sums only priced rows (CONTRACT §0)."""
    __slots__ = ("requests", "unpriced", "tokens", "cost", "priced", "sessions")

    def __init__(self):
        self.requests = self.unpriced = self.sessions = 0
        self.tokens, self.cost, self.priced = _tok(), 0.0, False

    def add(self, req, unp, t, cost):
        self.requests += req or 0
        self.unpriced += unp or 0
        for k, v in zip(self.tokens, t):
            self.tokens[k] += v or 0                          # a NULL column counts as 0
        if cost is not None:
            self.cost += cost
            self.priced = True


class _Day:
    def __init__(self):
        self.total = _Acc()
        self.agent = defaultdict(_Acc)
        self.model = defaultdict(_Acc)       # (model, agent)
        self.project = defaultdict(_Acc)     # project key
        self.machine = defaultdict(_Acc)     # machine code
        self.hourly = defaultdict(_Acc)      # local hour 0..23


def _usage(conn, tz, first_day):
    """Aggregate usage and sessions by local day from first_day on."""
    lo = datetime.combine(first_day, datetime.min.time(), tz).astimezone(UTC).strftime("%Y-%m-%dT%H:00:00Z")
    local = {}

    def cut(hour):
        if hour not in local:
            d = _parse(hour).astimezone(tz)
            local[hour] = (d.date(), d.hour)
        return local[hour]

    days = defaultdict(_Day)
    for machine, hour, agent, model, project, req, unp, i, o, cr, cw, rs, cost in conn.execute(
            "SELECT machine, hour, agent, model, project, requests, unpriced, input, output, cache_read, cache_write, "
            "reasoning, cost FROM usage WHERE hour >= ?", (lo,)):
        d, h = cut(hour)
        day, t = days[d], (i, o, cr, cw, rs)
        for acc in (day.total, day.agent[agent], day.model[(model, agent)], day.project[project], day.machine[machine],
                    day.hourly[h]):
            acc.add(req, unp, t, cost)
    for machine, hour, agent, project, n in conn.execute(
            "SELECT machine, hour, agent, project, count FROM sessions WHERE hour >= ?", (lo,)):
        day = days[cut(hour)[0]]
        day.total.sessions += n
        day.agent[agent].sessions += n
        day.project[project].sessions += n
        day.machine[machine].sessions += n
    return days


def _hit(t):
    den = t["input"] + t["cacheRead"] + t["cacheWrite"]
    return round(t["cacheRead"] / den, 4) if den else 0.0


def _agents(day):
    return [{"agent": a, "requests": day.agent[a].requests, "sessions": day.agent[a].sessions,
             "tokens": dict(day.agent[a].tokens), "costUsd": _r(day.agent[a].cost)}
            for a in AGENTS if a in day.agent]


def _models(day, detail=False):
    out = []
    for (model, agent), acc in sorted(day.model.items(), key=lambda kv: (-kv[1].cost, -kv[1].requests, kv[0])):
        m = {"model": model, "agent": agent, "requests": acc.requests,
             "costUsd": _r(acc.cost) if acc.priced else None}          # null only when nothing is priced
        if detail:
            m.update(unpricedRequests=acc.unpriced, tokens=dict(acc.tokens))
        out.append(m)
    return out


def _projects_of(day, projects, detail=False):
    out = []
    for key, acc in sorted(day.project.items(), key=lambda kv: (-kv[1].cost, -kv[1].requests, kv[0])):
        name, vis = projects.get(key, (None, None))
        p = {"project": name or key, "public": vis == "public", "requests": acc.requests, "costUsd": _r(acc.cost)}
        if detail:
            p.update(sessions=acc.sessions, unpricedRequests=acc.unpriced)
        out.append(p)
    return out


def _machines_of(day):
    return [{"machine": m, "requests": acc.requests, "sessions": acc.sessions, "unpricedRequests": acc.unpriced,
             "tokens": dict(acc.tokens), "costUsd": _r(acc.cost)}
            for m, acc in sorted(day.machine.items(), key=lambda kv: (-kv[1].cost, -kv[1].requests, kv[0] or ""))]


def _today(day, projects):
    t = day.total
    return {
        "requests": t.requests, "sessions": t.sessions, "unpricedRequests": t.unpriced,
        "tokens": dict(t.tokens), "cacheHitRate": _hit(t.tokens), "costUsd": _r(t.cost),
        "byAgent": [{k: v for k, v in a.items() if k != "sessions"} for a in _agents(day)],
        "byModel": _models(day),
        "byProject": _projects_of(day, projects),
        "hourly": [{"hour": h, "requests": day.hourly[h].requests, "costUsd": _r(day.hourly[h].cost)}
                   for h in range(24)],
    }


def _trend_cost(day):
    return {a: _r(day.agent[a].cost) if a in day.agent else 0.0 for a in AGENTS}


def _usage_day(d, day, projects):
    t = day.total
    return {"date": d.isoformat(), "requests": t.requests, "sessions": t.sessions, "unpricedRequests": t.unpriced,
            "tokens": dict(t.tokens), "cacheHitRate": _hit(t.tokens), "costUsd": _r(t.cost),
            "byAgent": _agents(day), "byModel": _models(day, True), "byProject": _projects_of(day, projects, True),
            "byMachine": _machines_of(day)}


# ------------------------------------------------------------------------------ quota
def _quota(conn, cfg, iso, warnings):
    codes = cfg.get("accounts") or {}
    out, unnamed = [], set()
    # The latest sample per (account, agent, window) (CONTRACT §1.1); sampled_at is ISO Z text.
    latest = conn.execute(
        "SELECT q.account, q.agent, q.window, q.sampled_at, q.used_pct, q.resets_at FROM quota q JOIN "
        "(SELECT account, agent, window, MAX(sampled_at) AS m FROM quota GROUP BY account, agent, window) l "
        "ON q.account = l.account AND q.agent = l.agent AND q.window = l.window AND q.sampled_at = l.m "
        "ORDER BY q.agent, q.account, q.window").fetchall()
    for acct, agent, win, t, pct, reset in latest:
        start = (_parse(reset) - WINDOW[win]).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        hist = conn.execute("SELECT sampled_at, used_pct FROM quota WHERE account=? AND agent=? AND window=? "
                            "AND sampled_at >= ? AND sampled_at <= ? ORDER BY sampled_at", (acct, agent, win, start, t))
        if acct not in codes:
            unnamed.add(acct)
        out.append({"account": codes.get(acct, acct), "agent": agent, "window": win, "usedPct": pct,
                    "resetsAt": iso(reset), "sampledAt": iso(t),
                    "history": [{"t": iso(st), "usedPct": sp} for st, sp in hist]})
    for acct in sorted(unnamed):
        warnings.append({"t": None, "machine": None, "kind": "unnamed-account",
                         "detail": f"quota account {acct} has no code in [accounts]"})
    return out


# ------------------------------------------------------------------------------ code activity
def _commits(conn, since_utc):
    """Commits deduplicated by hash across sources (CONTRACT §2.1): github > gitea > local. A local
    commit counts even when it was pushed but no collector has it (private repo, other branch, no
    token): the local fallback. A winner from github / gitea borrows the machine of a local copy."""
    vis = dict(conn.execute("SELECT key, visibility FROM projects"))
    by_hash = defaultdict(list)
    for row in conn.execute(
            "SELECT source, hash, machine, t, repo, remote, project, branch, title, url, pushed, private "
            "FROM commits WHERE t >= ?", (since_utc,)):
        by_hash[row[1]].append(row)
    out = []
    for h, rows in by_hash.items():
        machines = sorted({r[2] for r in rows if r[0] == "local" and r[2]})
        src, _, mach, t, repo, remote, project, branch, title, url, pushed, private = min(
            rows, key=lambda r: (SOURCE_RANK.get(r[0], 9), r[2]))
        if src == "local":
            public = vis.get(project) == "public"
        else:
            public = src == "github" and private == 0
            mach = machines[0] if machines else None
        out.append({"t": t, "source": src, "repo": repo, "remote": remote, "public": public, "title": title or "",
                    "branch": branch, "hash": h, "url": url if src != "local" else None, "machine": mach or None,
                    "pushed": bool(pushed) if src == "local" else True})
    out.sort(key=lambda c: (c["t"], c["hash"]), reverse=True)
    return out


def _activity_item(c, iso):
    return {"t": iso(c["t"]), "source": c["source"], "repo": c["repo"], "public": c["public"], "title": c["title"],
            "branch": c["branch"], "hash": c["hash"], "url": c["url"], "machine": c["machine"], "pushed": c["pushed"]}


def _repos(commits, iso):
    repos = {}
    for c in commits:                                         # newest first
        k = c["remote"] or ("", c["repo"])                     # one row per remote, whatever the name
        r = repos.get(k)
        if r is None:
            r = repos[k] = {"repo": c["repo"], "public": c["public"], "sources": set(), "commits": 0,
                            "unpushed": 0, "machines": set(), "lastCommit": iso(c["t"])}
        r["commits"] += 1
        r["unpushed"] += not c["pushed"]
        r["sources"].add(c["source"])
        if c["machine"]:
            r["machines"].add(c["machine"])
    out = [{**r, "sources": sorted(r["sources"], key=SOURCE_RANK.get), "machines": sorted(r["machines"])}
           for r in repos.values()]
    out.sort(key=lambda r: (r["lastCommit"], r["repo"]), reverse=True)
    return out


# ------------------------------------------------------------------------------ machines and services
# Machine icon and colour (hub config [machines.X] icon / color). Closed lists: the public snapshot
# carries them (public_fields.json enum), the front end draws the icons as 5x5 cell glyphs.
MACHINE_ICONS = ("laptop", "desktop", "server", "vm", "nas", "mini", "cloud", "pi")
MACHINE_COLORS = ("blue", "green", "paper", "violet", "orange", "cyan", "yellow", "red")


def default_icon(role, os_):
    """An icon from role and OS when none is configured: dev/work machines are laptops (desktops
    off macOS), a Linux deploy machine is taken to be a VM, a macOS one a mini, the rest servers."""
    if role in ("dev", "work"):
        return "laptop" if os_ in ("macos", None) or role == "work" else "desktop"
    if role == "deploy":
        return {"macos": "mini", "linux": "vm"}.get(os_, "server")
    if role == "gitea":
        return "nas" if os_ == "macos" else "server"
    return "server"


def default_color(code):
    """A fixed colour per machine code, so a machine keeps its colour across pages and days."""
    return MACHINE_COLORS[sum(map(ord, str(code))) % len(MACHINE_COLORS)]


def _pick(o, key, allowed, default, mid, warnings):
    """Configured value if it is on the list; a configured value off the list is dropped (null)
    with a warning; no value at all gets the default."""
    if key not in o:
        return default
    v = o[key]
    if isinstance(v, str) and v in allowed:
        return v
    warnings.append({"t": None, "machine": mid, "kind": "machine-config",
                     "detail": f"[machines.{mid}] {key} must be one of: {', '.join(allowed)}"})
    return None


def _today_by_machine(conn, tz, today):
    """machine -> [{agent, requests, unpricedRequests, costUsd, sessions}] for the local day
    `today` (CONTRACT §2.2, provisional). Cost sums priced rows only, as everywhere (§0)."""
    lo, hi = (datetime.combine(d, datetime.min.time(), tz).astimezone(UTC).strftime("%Y-%m-%dT%H:00:00Z")
              for d in (today, today + timedelta(days=1)))
    acc = defaultdict(lambda: {"requests": 0, "unpricedRequests": 0, "costUsd": 0.0, "sessions": 0})
    for m, agent, req, unp, cost in conn.execute(
            "SELECT machine, agent, SUM(requests), SUM(unpriced), SUM(cost) FROM usage "
            "WHERE hour >= ? AND hour < ? GROUP BY machine, agent", (lo, hi)):
        a = acc[(m, agent)]
        a.update(requests=req or 0, unpricedRequests=unp or 0, costUsd=_r(cost or 0.0))
    for m, agent, n in conn.execute(
            "SELECT machine, agent, SUM(count) FROM sessions WHERE hour >= ? AND hour < ? GROUP BY machine, agent", (lo, hi)):
        acc[(m, agent)]["sessions"] = n or 0
    out = defaultdict(list)
    for (m, agent), a in sorted(acc.items(), key=lambda kv: (kv[0][0], AGENTS.index(kv[0][1]) if kv[0][1] in AGENTS else 9, kv[0][1])):
        out[m].append({"agent": agent, **a})
    return out


def _machines(conn, cfg, now_ts, iso, by_agent=None, warnings=None):
    over = cfg.get("machines") or {}
    reg = {m: (role, os_, label, last) for m, role, os_, label, last in
           conn.execute("SELECT id, role, os, label, last_report FROM machines")}
    state = {m: (st, up, upd) for m, st, up, upd in conn.execute("SELECT machine, status, uptime, updated FROM machine_state")}
    stats = defaultdict(list)
    for row in conn.execute("SELECT machine, t, cpu, mem_used, mem_total, disk_used, disk_total FROM machine_stats ORDER BY t"):
        stats[row[0]].append(row[1:])
    since = datetime.fromtimestamp(now_ts - 24 * 3600, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        current = json.loads(db.get(conn, "beszel.now") or "{}")
    except ValueError:
        current = {}
    out = []
    for mid in sorted(set(reg) | set(state) | set(over)):
        role, os_, label, last = reg.get(mid, (None, None, None, None))
        o = over.get(mid) or {}
        st, uptime, updated = state.get(mid, (None, None, None))
        beszel_up = st == "up" and updated is not None and now_ts - updated <= STALE
        probe_up = last is not None and now_ts - last <= STALE
        seen = [x for x in (updated if st == "up" else None, last) if x is not None]
        pts = stats.get(mid, [])
        system = None
        cur = current.get(mid) if isinstance(current, dict) else None
        cur_vals = [cur.get(k) for k in ("cpu", "mu", "m", "du", "d")] if isinstance(cur, dict) else [None]
        try:
            cur_age = now_ts - datetime.fromisoformat(cur["t"].replace("Z", "+00:00")).timestamp()
        except (TypeError, KeyError, ValueError, AttributeError):
            cur_age = None
        if uptime is not None and None not in cur_vals and cur_age is not None and cur_age <= STALE:
            cpu, mu, mt, du, dt = cur_vals            # fresh 1-minute record: near-real-time values
            system = {"cpuPct": cpu, "memUsed": mu, "memTotal": mt, "diskUsed": du, "diskTotal": dt, "uptimeSec": uptime}
        elif pts and uptime is not None and None not in pts[-1][1:]:
            _, cpu, mu, mt, du, dt = pts[-1]          # fallback: last 20-minute point (up to 20 min behind)
            system = {"cpuPct": cpu, "memUsed": mu, "memTotal": mt, "diskUsed": du, "diskTotal": dt, "uptimeSec": uptime}
        pct = lambda a, b: round(a / b * 100, 1) if a is not None and b else None
        out.append({
            "id": mid, "label": o.get("label") or label or mid, "role": o.get("role") or role, "os": o.get("os") or os_,
            "icon": _pick(o, "icon", MACHINE_ICONS, default_icon(o.get("role") or role, o.get("os") or os_), mid, warnings if warnings is not None else []),
            "color": _pick(o, "color", MACHINE_COLORS, default_color(mid), mid, warnings if warnings is not None else []),
            "online": beszel_up or probe_up, "lastSeen": iso(max(seen)) if seen else None,
            "probeLastReport": iso(last) if last is not None else None, "system": system,
            "history": [{"t": iso(t), "cpuPct": cpu, "memPct": pct(mu, mt), "diskPct": pct(du, dt)}
                        for t, cpu, mu, mt, du, dt in pts if t >= since and cpu is not None],
            "todayByAgent": (by_agent or {}).get(mid, []),      # provisional (CONTRACT §2.2)
        })
    return out


def _norm(s):
    return re.sub(r"[^0-9a-z]", "", (s or "").casefold())


def _services(conn, cfg):
    """One row per service: a container (Beszel stats / Docker state) and the Kuma monitor of the
    same service are merged here, before any masking (CONTRACT §2)."""
    merge = (cfg.get("services") or {}).get("merge") or {}
    cont = {}
    for m, name, cpu, mem in conn.execute("SELECT machine, name, cpu, mem FROM container_stats"):
        cont[(m, name)] = {"cpu": cpu, "mem": mem, "state": None, "seen": True}
    for m, name, status in conn.execute("SELECT machine, name, status FROM container_state"):
        cont.setdefault((m, name), {"cpu": None, "mem": None, "state": None, "seen": False})["state"] = status
    used, out = set(), []
    for _, name, mach, status, up24 in conn.execute("SELECT id, name, machine, status, uptime24 FROM monitors ORDER BY name"):
        want = merge.get(name)
        cands = [k for k in cont if (mach is None or k[0] == mach)
                 and (k[1] == want if want else _norm(k[1]) == _norm(name))]
        row = {"name": name, "kind": "monitor", "machine": mach, "status": status or "unknown",
               "uptimePct24h": up24, "cpuPct": None, "memBytes": None}
        # A monitor without a machine merges only with a container whose name is unique across machines.
        cands = [k for k in cands if k not in used] if mach is not None or len(cands) == 1 else []
        if cands:
            k = cands[0]
            used.add(k)
            c = cont[k]
            row.update(kind="both", machine=k[0], cpuPct=c["cpu"], memBytes=c["mem"])
            if c["state"] and STATUS_RANK.get(c["state"], 4) < STATUS_RANK.get(row["status"], 4):
                row["status"] = c["state"]                    # the worse of the two
        out.append(row)
    for (mach, name), c in cont.items():
        if (mach, name) in used:
            continue
        out.append({"name": name, "kind": "container", "machine": mach,
                    "status": c["state"] or ("up" if c["seen"] else "unknown"),     # Beszel lists running containers
                    "uptimePct24h": None, "cpuPct": c["cpu"], "memBytes": c["mem"]})
    out.sort(key=lambda s: (s["machine"] or "", _norm(s["name"]), s["name"]))
    return out


# ------------------------------------------------------------------------------ page
def build(conn, cfg, now=None):
    now = (now or datetime.now(UTC)).astimezone(UTC)
    tz = zone(cfg, now)
    now_ts = now.timestamp()

    def iso(v):
        d = _parse(v)
        return None if d is None else d.astimezone(tz).isoformat(timespec="seconds")

    today = now.astimezone(tz).date()
    projects = {k: (n, v) for k, n, v in conn.execute("SELECT key, name, visibility FROM projects")}
    first = today - timedelta(days=DETAIL_DAYS - 1)
    days = _usage(conn, tz, first)
    span = [first + timedelta(days=i) for i in range(DETAIL_DAYS)]
    blank = _Day()
    warnings = []

    # contributions: from the Sunday 53 weeks back up to today (CONTRACT §2)
    c_start = today - timedelta(days=52 * 7 + today.isoweekday() % 7)
    c_start_utc = datetime.combine(c_start, datetime.min.time(), tz).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    commits = _commits(conn, c_start_utc)
    counts = defaultdict(int)
    for c in commits:
        counts[_parse(c["t"]).astimezone(tz).date()] += 1
    cdays = [{"date": (c_start + timedelta(days=i)).isoformat(), "count": counts.get(c_start + timedelta(days=i), 0)}
             for i in range((today - c_start).days + 1)]
    contributions = {"total": sum(d["count"] for d in cdays), "days": cdays}
    try:
        official = json.loads(db.get(conn, "github.calendar") or "null")
    except ValueError:
        official = None
    if official and isinstance(official.get("total"), int):
        contributions["githubOfficialTotal"] = official["total"]
    detail_since = datetime.combine(first, datetime.min.time(), tz).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    reports = {m: last for m, last in conn.execute("SELECT id, last_report FROM machines")}
    runtimes = [{"machine": m, "agent": a, "version": v, "processes": p, "activeSessions": s,
                 "stale": reports.get(m) is None or now_ts - reports[m] > STALE}
                for m, a, v, p, s in conn.execute(
                    "SELECT machine, agent, version, processes, active FROM runtimes ORDER BY machine, agent")]
    jobs = [{"name": n, "machine": m, "lastRun": iso(lr), "lastSuccess": iso(ls), "ok": bool(ok)}
            for m, n, lr, ls, ok in conn.execute("SELECT machine, name, last_run, last_success, ok FROM jobs ORDER BY machine, name")]
    tailnet = [{"name": n, "os": o, "online": bool(on), "lastSeen": iso(ls)}
               for n, o, on, ls in conn.execute("SELECT name, os, online, last_seen FROM tailnet ORDER BY name")]
    quota = _quota(conn, cfg, iso, warnings)
    machines = _machines(conn, cfg, now_ts, iso, _today_by_machine(conn, tz, today), warnings)
    for t, m, kind, detail in conn.execute(
            "SELECT t, machine, kind, detail FROM warnings WHERE t >= ? ORDER BY t DESC LIMIT 50", (now_ts - 7 * 86400,)):
        warnings.append({"t": iso(t), "machine": m, "kind": kind, "detail": detail})

    return {
        "schema": "glassbox.page/1", "view": "private",
        "generatedAt": now.astimezone(tz).isoformat(timespec="seconds"), "tz": cfg.get("tz", "Asia/Tokyo"),
        "pricingVersion": pricing.VERSION,
        "today": _today(days.get(today, blank), projects),
        "trend": [{"date": d.isoformat(), "costUsd": _trend_cost(days.get(d, blank))} for d in span[-TREND_DAYS:]],
        "quota": quota,
        "contributions": contributions,
        "activity": [_activity_item(c, iso) for c in commits[:ACTIVITY_MAX]],
        "machines": machines,
        "services": _services(conn, cfg),
        "runtimes": runtimes,
        "tailnet": tailnet,
        "jobs": jobs,
        "hidden": [],
        # provisional detail blocks (CONTRACT §2.2): private only until the exporter allowlists them
        "usageDays": [_usage_day(d, days.get(d, blank), projects) for d in span],
        "code": {"repos": _repos(commits, iso),
                 "commits": [_activity_item(c, iso) for c in commits if c["t"] >= detail_since][:CODE_COMMITS_MAX]},
        "warnings": warnings,
    }


WEB = Path(__file__).resolve().parent.parent / "web"
MARKER = '<script id="gb-data"></script>'      # in web/index.html; replaced by the page data
# First element of <head> on every page, private and public (the publish gate checks it verbatim).
CSP = ('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; '
       'style-src \'unsafe-inline\'; img-src data:; font-src data:; connect-src \'none\'; base-uri \'none\'; '
       'form-action \'none\'">')
_LINK = re.compile(r'<link rel="stylesheet" href="([a-z0-9-]+\.css)">')
_SCRIPT = re.compile(r'<script src="([a-z0-9-]+\.js)"></script>')
_CLOSE = re.compile(r"</(script|style)|<!--|<script", re.I)     # would end or confuse the inline element
_FAVICON = re.escape('<link rel="icon" href="data:,">')                  # the one link allowed


def html(page, template):
    """The template with the page data inlined as its own script, `window.GB = <strict JSON>;`
    (CONTRACT §2). "<" and the JS line separators are escaped, which keeps the JSON valid."""
    data = json.dumps(page, ensure_ascii=False, allow_nan=False)
    data = data.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    if template.count(MARKER) != 1:
        raise ValueError("template must have exactly one gb-data script tag")
    return template.replace(MARKER, f"<script>window.GB = {data};</script>", 1)


def bundle(page, web=WEB):
    """One self-contained HTML document for page/1 data: web/index.html with every stylesheet and
    script inlined and the data injected. Used for the private view and the public snapshot alike;
    the CSP allows inline code only, so nothing may be loaded from a file or URL."""
    web = Path(web)
    template = (web / "index.html").read_text(encoding="utf-8")
    head = template.split("<head>", 1)[1].lstrip() if "<head>" in template else ""
    if not head.startswith(CSP):
        raise ValueError("web/index.html: the CSP meta must be the first element of <head>")

    def inline(kind):
        def sub(m):
            text = (web / m.group(1)).read_text(encoding="utf-8")
            if _CLOSE.search(text):
                raise ValueError(f"web/{m.group(1)} contains </script, </style, <!-- or <script")
            return f"<{kind}>\n{text}</{kind}>"
        return sub

    out = _LINK.sub(inline("style"), template)
    out = _SCRIPT.sub(inline("script"), out)
    if re.search(r"<script\b[^>]*\bsrc=", out, re.I) or re.sub(_FAVICON, "", out).lower().count("<link"):
        raise ValueError("web/index.html references a file the bundler cannot inline")
    return html(page, out)
