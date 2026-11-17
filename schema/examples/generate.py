#!/usr/bin/env python3
"""Generate the fabricated example files for schema/CONTRACT.md, and self-check them.

Everything here is made up. Public repo names are the owner's real public
repositories; private names are invented and must never reach the public file.
The public example is built by whitelist rebuild (CONTRACT §3 rule 1), which is
a prototype of the S11 exporter.

    python3 -I schema/examples/generate.py
"""
import json
import random
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIELDS = json.loads((HERE.parent / "public_fields.json").read_text(encoding="utf-8"))
TZ = timezone(timedelta(hours=9))
NOW = datetime(2026, 11, 17, 10, 30, tzinfo=TZ)
UTC = timezone.utc
rnd = random.Random(20261117)


def iso(dt):
    return dt.isoformat(timespec="seconds")


def zulu(dt):
    return dt.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def tok(i, o, cr, cw, r):
    return {"input": i, "output": o, "cacheRead": cr, "cacheWrite": cw, "reasoning": r}


# --- fabricated identities ------------------------------------------------------
PUBLIC_REPOS = {"sdtm-pedia", "shuttle-path", "IT-Passport-Learning"}
PRIVATE_NAMES = ["falcon-ledger", "orchid-batch", "ACME-42", "studio-dev", "client-laptop",
                 "home-server", "garage-mbp", "pocket-phone", "nightly-backup", "gitea.example.org",
                 "billing-api", "a_1f2e3d4c", "a_9c8b7a6d"]
PROJECTS = {
    "p_1a2b3c4d5e6f": {"name": "sdtm-pedia", "remote": "github.com/hakupao/sdtm-pedia"},
    "p_3c4d5e6f7081": {"name": "falcon-ledger", "remote": "gitea.example.org/team/falcon-ledger"},
    "p_4d5e6f708192": {"name": "orchid-batch", "remote": None},
    "p_other": {"name": "other", "remote": None},
}

# --- probe example ----------------------------------------------------------------
h0 = datetime(2026, 11, 17, 0, 0, tzinfo=UTC)          # 09:00 JST
probe = {
    "schema": "glassbox.probe/1", "machine": "A", "probeVersion": "0.1.0", "pricingVersion": "2026-11-17",
    "sentAt": zulu(NOW), "tz": "Asia/Tokyo",
    "usage": {
        "range": {"from": "2026-11-15T00:00:00Z", "to": "2026-11-17T02:00:00Z"},
        "rows": [
            {"hourStart": zulu(h0), "agent": "claude-code", "model": "claude-opus-5-5", "project": "p_1a2b3c4d5e6f",
             "requests": 120, "unpricedRequests": 0, "tokens": tok(310, 52_000, 3_900_000, 180_000, 9_000), "costUsd": 3.12},
            {"hourStart": zulu(h0), "agent": "claude-code", "model": "claude-fable-5-1", "project": "p_1a2b3c4d5e6f",
             "requests": 4, "unpricedRequests": 0, "tokens": tok(110_000, 9_900, 0, 0, 0), "costUsd": 1.6},
            {"hourStart": zulu(h0 + timedelta(hours=1)), "agent": "codex", "model": "gpt-6-astra", "project": "p_3c4d5e6f7081",
             "requests": 31, "unpricedRequests": 0, "tokens": tok(41_000, 8_200, 690_000, 0, 1_100), "costUsd": 1.51},
        ],
        "sessions": [
            {"hourStart": zulu(h0), "agent": "claude-code", "project": "p_1a2b3c4d5e6f", "count": 2},
            {"hourStart": zulu(h0 + timedelta(hours=1)), "agent": "codex", "project": "p_3c4d5e6f7081", "count": 1},
        ],
    },
    "projects": PROJECTS,
    "quota": [
        {"account": "a_1f2e3d4c", "agent": "claude-code", "window": "7d", "usedPct": 41,
         "resetsAt": "2026-11-20T00:00:00Z", "sampledAt": zulu(NOW)},
        {"account": "a_9c8b7a6d", "agent": "codex", "window": "5h", "usedPct": 55,
         "resetsAt": "2026-11-17T04:10:00Z", "sampledAt": zulu(NOW)},
    ],
    "runtimes": [{"agent": "claude-code", "version": "2.1.326", "processes": 3, "activeSessions": 2},
                 {"agent": "codex", "version": "0.99.0", "processes": 1, "activeSessions": 1}],
    "git": [{"project": "p_4d5e6f708192", "remote": False, "commits": [
        {"t": "2026-11-17T00:48:00Z", "hash": "e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4",
         "branch": "main", "title": "fix: handle empty mapping rule"}]}],
    "jobs": [{"name": "nightly-backup", "lastRun": "2026-11-16T18:00:05Z", "lastSuccess": "2026-11-16T18:00:05Z", "ok": True}],
}

# --- page example (private view) --------------------------------------------------
trend = []
for k in range(30):
    d = date(2026, 10, 19) + timedelta(days=k)
    trend.append({"date": d.isoformat(), "costUsd": {"claude-code": round(rnd.uniform(5, 45), 2),
                                                      "codex": round(rnd.uniform(0, 9), 2)}})
trend[-1]["costUsd"] = {"claude-code": 41.2, "codex": 7.5}

today_d = date(2026, 11, 17)
start = today_d - timedelta(days=52 * 7 + (today_d.isoweekday() % 7))   # the Sunday 53 weeks back
days = []
d = start
while d <= today_d:
    days.append({"date": d.isoformat(), "count": 0 if rnd.random() < 0.3 else rnd.randint(1, 30)})
    d += timedelta(days=1)

MACHINES = [("A", "studio-dev", "dev", "macos"), ("B", "client-laptop", "work", "windows"),
            ("C", "home-server", "deploy", "linux"), ("D", "garage-mbp", "gitea", "macos")]
page = {
    "schema": "glassbox.page/1", "view": "private", "generatedAt": iso(NOW), "tz": "Asia/Tokyo",
    "pricingVersion": "2026-11-17",
    "today": {
        "requests": 1284, "sessions": 23, "unpricedRequests": 0,
        "tokens": tok(3_420_000, 610_000, 41_800_000, 2_100_000, 180_000),
        "cacheHitRate": round(41_800_000 / (3_420_000 + 41_800_000 + 2_100_000), 4), "costUsd": 48.7,
        "byAgent": [
            {"agent": "claude-code", "requests": 1032, "tokens": tok(3_100_000, 560_000, 39_000_000, 2_100_000, 150_000), "costUsd": 41.2},
            {"agent": "codex", "requests": 252, "tokens": tok(320_000, 50_000, 2_800_000, 0, 30_000), "costUsd": 7.5},
        ],
        "byModel": [
            {"model": "claude-opus-5-5", "agent": "claude-code", "requests": 812, "costUsd": 36.9},
            {"model": "claude-sonnet-5-5", "agent": "claude-code", "requests": 220, "costUsd": 4.3},
            {"model": "gpt-6-astra", "agent": "codex", "requests": 252, "costUsd": 7.5},
        ],
        "byProject": [
            {"project": "sdtm-pedia", "public": True, "requests": 410, "costUsd": 15.1},
            {"project": "falcon-ledger", "public": False, "requests": 520, "costUsd": 20.4},
            {"project": "orchid-batch", "public": False, "requests": 214, "costUsd": 8.0},
            {"project": "shuttle-path", "public": True, "requests": 140, "costUsd": 5.2},
        ],
        "hourly": [{"hour": h, "requests": r, "costUsd": round(r * 0.038, 2)}
                   for h, r in enumerate([0] * 7 + [12, 88, 160, 140] + [0] * 13)],
    },
    "trend": trend,
    "quota": [
        {"account": "K", "agent": "claude-code", "window": "7d", "usedPct": 41,
         "resetsAt": "2026-11-20T09:00:00+09:00", "sampledAt": iso(NOW),
         "history": [{"t": iso(NOW - timedelta(hours=12 * (14 - i))), "usedPct": p}
                     for i, p in enumerate([0, 3, 6, 9, 11, 14, 17, 20, 22, 25, 28, 31, 34, 37, 41])]},
        {"account": "L", "agent": "codex", "window": "5h", "usedPct": 55,
         "resetsAt": "2026-11-17T13:10:00+09:00", "sampledAt": iso(NOW),
         "history": [{"t": iso(NOW - timedelta(minutes=20 * (7 - i))), "usedPct": p}
                     for i, p in enumerate([0, 6, 13, 21, 30, 38, 46, 55])]},
        {"account": "L", "agent": "codex", "window": "7d", "usedPct": 70,
         "resetsAt": "2026-11-20T00:00:00+09:00", "sampledAt": iso(NOW), "history": []},
    ],
    "contributions": {"total": sum(x["count"] for x in days), "days": days},
    "activity": [
        {"t": "2026-11-17T10:12:00+09:00", "source": "github", "repo": "IT-Passport-Learning", "public": True,
         "title": "feat: 第 12 章模拟题解析", "branch": "main", "hash": "a91c3e2",
         "url": "https://github.com/hakupao/IT-Passport-Learning/commit/a91c3e2", "machine": "A"},
        {"t": "2026-11-17T09:48:00+09:00", "source": "local", "repo": "orchid-batch", "public": False,
         "title": "fix: handle empty mapping rule", "branch": "main", "hash": "e1f2a3b", "url": None, "machine": "A"},
        {"t": "2026-11-16T22:31:00+09:00", "source": "gitea", "repo": "falcon-ledger", "public": False,
         "title": "refactor: split validation pipeline for ACME-42", "branch": "dev", "hash": "77c0d1e",
         "url": "https://gitea.example.org/team/falcon-ledger/commit/77c0d1e", "machine": "B"},
    ],
    "machines": [
        {"id": i, "label": label, "role": role, "os": os_, "online": i != "D",
         "lastSeen": iso(NOW - timedelta(minutes=2 if i != "D" else 600)),
         "probeLastReport": iso(NOW - timedelta(minutes=3)) if role in ("dev", "work") else None,
         "system": {"cpuPct": 12.5, "memUsed": 9.1e9, "memTotal": 16e9, "diskUsed": 410e9, "diskTotal": 1e12, "uptimeSec": 593_000},
         "history": [{"t": iso(NOW - timedelta(hours=23 - h)), "cpuPct": round(8 + 6 * rnd.random(), 1),
                      "memPct": round(50 + 10 * rnd.random(), 1)} for h in range(24)]}
        for i, label, role, os_ in MACHINES
    ],
    "services": [
        {"name": "gitea", "kind": "container", "machine": "C", "status": "up", "uptimePct24h": 100.0, "cpuPct": 0.4, "memBytes": 210e6},
        {"name": "billing-api", "kind": "container", "machine": "C", "status": "up", "uptimePct24h": 99.3, "cpuPct": 2.1, "memBytes": 480e6},
        {"name": "status-page", "kind": "monitor", "machine": "C", "status": "down", "uptimePct24h": 96.5, "cpuPct": None, "memBytes": None},
    ],
    "runtimes": [
        {"machine": "A", "agent": "claude-code", "version": "2.1.326", "processes": 3, "activeSessions": 2, "stale": False},
        {"machine": "A", "agent": "codex", "version": "0.99.0", "processes": 1, "activeSessions": 1, "stale": False},
        {"machine": "B", "agent": "claude-code", "version": "2.1.320", "processes": 1, "activeSessions": 1, "stale": False},
    ],
    "tailnet": [{"name": "studio-dev", "os": "macos", "online": True, "lastSeen": iso(NOW)},
                {"name": "pocket-phone", "os": "ios", "online": False, "lastSeen": iso(NOW - timedelta(hours=5))}],
    "jobs": [{"name": "nightly-backup", "machine": "C", "lastRun": "2026-11-17T03:00:05+09:00",
              "lastSuccess": "2026-11-17T03:00:05+09:00", "ok": True}],
    "hidden": [],
}

# --- public view: whitelist rebuild (prototype of the S11 exporter) -------------------
# In the real exporter these come from .local/public.local.toml and GitHub visibility.
# Text allowlists are per field (CONTRACT §3 rule 2).
ALLOW = {
    "today.byProject[].project": PUBLIC_REPOS,
    "activity[].repo": PUBLIC_REPOS,
    "activity[].branch": {"main", "dev"},           # branches of public repos, added automatically
    "services[].name": {"gitea", "status-page"},
}
CODES = {"A", "B", "C", "D", "K", "L"}             # machine and account codes
HIDDEN = ["tailnet"]
KEYWORDS = ["ACME-42"]
MODELS = {"claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "gpt-6-astra"}
PUBLIC_URL = re.compile(r"^https://github\.com/hakupao/(" + "|".join(map(re.escape, PUBLIC_REPOS)) + r")/")
TICKET = re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b")
ISO = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)$")
DATE = re.compile(r"^\d{4}-\d\d-\d\d$")
MASK = {"masked": True}


def pattern_for(path):
    return re.compile("^" + re.escape(path).replace(r"\[\]", r"\[\d+\]") + "$")


SPEC = [(pattern_for(p), p, t) for p, t in FIELDS["paths"].items()]


def spec_for(path):
    for rx, generic, typ in SPEC:
        if rx.match(path):
            return generic, typ
    return None, None


def is_list_path(path):
    return any(rx.match(path + "[0]") for rx, _, _ in SPEC) or any(
        g.startswith(re.sub(r"\[\d+\]", "[]", path) + "[]") for _, g, _ in SPEC)


def rebuild(node, path=""):
    """Copy only whitelisted leaves; mask Text leaves that are not on that field's allowlist."""
    if isinstance(node, dict):
        if node.get("masked") is True and spec_for(path)[1] in ("text", "text?"):
            return node
        out = {}
        for k, v in node.items():
            r = rebuild(v, f"{path}.{k}" if path else k)
            if r is not _DROP:
                out[k] = r
        return out if out or not path else _DROP
    if isinstance(node, list):
        if not is_list_path(path):
            return _DROP
        return [r for i, v in enumerate(node) if (r := rebuild(v, f"{path}[{i}]")) is not _DROP]
    generic, typ = spec_for(path)
    if typ is None:
        return _DROP
    if typ.rstrip("?") == "text" and node is not None and node not in ALLOW.get(generic, ()):
        return dict(MASK)
    return node


def check_type(value, typ, generic):
    """Gate rule 3: every public value must match its declared type."""
    if typ.endswith("?"):
        if value is None:
            return True
        typ = typ[:-1]
    kind, _, arg = typ.partition(":")
    if kind == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if kind == "bool":
        return isinstance(value, bool)
    if kind == "null":
        return value is None
    if not isinstance(value, (str, dict)):
        return False
    if kind == "text":
        return value == MASK or value == {"masked": True, "group": "private"} or value in ALLOW.get(generic, ())
    if not isinstance(value, str):
        return False
    return {
        "iso": lambda: bool(ISO.match(value)),
        "date": lambda: bool(DATE.match(value)),
        "hash": lambda: bool(re.fullmatch(r"[0-9a-f]{7,40}", value)),
        "semver": lambda: bool(re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", value)),
        "enum": lambda: value in arg.split("|"),
        "const": lambda: value == arg,
        "code": lambda: value in CODES,
        "model": lambda: value in MODELS or value == "other",
        "url": lambda: bool(PUBLIC_URL.match(value)),
        "title": lambda: not TICKET.search(value),
    }[kind]()


def gate(node, path=""):
    """Gate rules 1 and 3: reject unknown keys and mistyped values. Returns a list of problems."""
    bad = []
    if isinstance(node, dict) and not (node.get("masked") is True and spec_for(path)[1] in ("text", "text?")):
        for k, v in node.items():
            bad += gate(v, f"{path}.{k}" if path else k)
        return bad
    if isinstance(node, list):
        for i, v in enumerate(node):
            bad += gate(v, f"{path}[{i}]")
        return bad
    generic, typ = spec_for(path)
    if typ is None:
        return [f"unknown field {path}"]
    if not check_type(node, typ, generic):
        return [f"{path}: {node!r} is not {typ}"]
    return bad


_DROP = object()

src = json.loads(json.dumps(page))
src["view"] = "public"
src["today"].pop("hourly")                                         # rule 7
priv = [p for p in src["today"]["byProject"] if not p["public"]]
src["today"]["byProject"] = [p for p in src["today"]["byProject"] if p["public"]] + [{
    "project": {"masked": True, "group": "private"}, "public": False,
    "requests": sum(p["requests"] for p in priv), "costUsd": round(sum(p["costUsd"] for p in priv), 2)}]
for m in src["today"]["byModel"]:
    if m["model"] not in MODELS:
        m["model"] = "other"
for a in src["activity"]:
    if not a["public"]:                                              # rule 4
        a.update(branch=None, hash=None, url=None, machine=None, t=a["t"][:13] + ":00:00" + a["t"][19:])
        for kw in KEYWORDS:                                          # rule 5
            a["title"] = re.sub(re.escape(kw), "******", a["title"], flags=re.I)
        a["title"] = TICKET.sub("******", a["title"])
for h in HIDDEN:
    src[h] = []
src["hidden"] = HIDDEN
pub = rebuild(src)
assert isinstance(pub, dict)
problems = gate(pub)
assert not problems, "gate rejects public example:\n  " + "\n  ".join(problems)

for name, obj in (("probe.json", probe), ("page.private.json", page), ("page.public.json", pub)):
    (HERE / name).write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("wrote", name)

# --- self-checks ----------------------------------------------------------------------
refs = {r["project"] for r in probe["usage"]["rows"]} | {s["project"] for s in probe["usage"]["sessions"]} \
    | {g["project"] for g in probe["git"]}
assert refs <= set(probe["projects"]), f"probe references undeclared projects: {refs - set(probe['projects'])}"


def norm(s):
    return re.sub(r"[-_.\s]", "", s).casefold()


text = norm((HERE / "page.public.json").read_text(encoding="utf-8"))
leaks = [s for s in PRIVATE_NAMES if norm(s) in text]
assert not leaks, f"public example leaks: {leaks}"
assert all(a["hash"] is None and a["url"] is None and a["machine"] is None
           for a in pub["activity"] if not a["public"]), "private activity keeps identifiers"
assert "hourly" not in pub["today"] and pub["tailnet"] == [], "rule 7"
assert pub["contributions"]["total"] == sum(x["count"] for x in pub["contributions"]["days"])
assert pub["contributions"]["days"][0]["date"] == start.isoformat() and date.fromisoformat(start.isoformat()).isoweekday() == 7
assert page["trend"][-1]["date"] == today_d.isoformat()
print("self-checks ok")
