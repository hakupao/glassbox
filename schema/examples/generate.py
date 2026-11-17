#!/usr/bin/env python3
"""Generate the fabricated example files for schema/CONTRACT.md.

Everything here is made up. Public repo names are the owner's real public
repositories; private ones use invented names that only appear in the
private example and must be masked in the public one.

    python3 schema/examples/generate.py   # writes probe.json, page.private.json, page.public.json
"""
import copy
import json
import random
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent
TZ = timezone(timedelta(hours=9))
NOW = datetime(2026, 11, 17, 10, 30, tzinfo=TZ)
rnd = random.Random(20261117)


def iso(dt):
    return dt.isoformat(timespec="seconds")


def tok(i, o, cr, cw, r):
    return {"input": i, "output": o, "cacheRead": cr, "cacheWrite": cw, "reasoning": r}


# --- fabricated identities -------------------------------------------------
PROJECTS = {
    "p_1a2b3c4d5e6f": {"name": "sdtm-pedia", "remote": "github.com/hakupao/sdtm-pedia", "public": True},
    "p_2b3c4d5e6f70": {"name": "shuttle-path", "remote": "github.com/hakupao/shuttle-path", "public": True},
    "p_3c4d5e6f7081": {"name": "falcon-ledger", "remote": "gitea.example.org/team/falcon-ledger", "public": False},
    "p_4d5e6f708192": {"name": "orchid-batch", "remote": None, "public": False},
}
MACHINES = [
    ("A", "studio-dev", "dev", "macos"),
    ("B", "client-laptop", "work", "windows"),
    ("C", "home-server", "deploy", "linux"),
    ("D", "garage-mbp", "gitea", "macos"),
]

# --- probe example -----------------------------------------------------------
probe = {
    "schema": "glassbox.probe/1", "machine": "A", "probeVersion": "0.1.0",
    "sentAt": iso(NOW), "tz": "Asia/Tokyo",
    "usage": {"days": ["2026-11-17"], "rows": [
        {"day": "2026-11-17", "hour": 9, "agent": "claude-code", "model": "claude-opus-5-5",
         "project": "p_1a2b3c4d5e6f", "requests": 120, "sessions": 2,
         "tokens": tok(310, 52_000, 3_900_000, 180_000, 9_000), "costUsd": 3.12},
        {"day": "2026-11-17", "hour": 10, "agent": "codex", "model": "gpt-6-astra",
         "project": "p_3c4d5e6f7081", "requests": 31, "sessions": 1,
         "tokens": tok(41_000, 8_200, 690_000, 0, 1_100), "costUsd": 1.51},
    ]},
    "projects": {k: {"name": v["name"], "remote": v["remote"]} for k, v in PROJECTS.items()
                 if k in ("p_1a2b3c4d5e6f", "p_3c4d5e6f7081")},
    "quota": [
        {"agent": "claude-code", "window": "7d", "usedPct": 41, "resetsAt": "2026-11-20T09:00:00+09:00", "sampledAt": iso(NOW)},
        {"agent": "codex", "window": "5h", "usedPct": 55, "resetsAt": "2026-11-17T13:10:00+09:00", "sampledAt": iso(NOW)},
    ],
    "runtimes": [{"agent": "claude-code", "version": "2.1.326", "processes": 3, "activeSessions": 2},
                 {"agent": "codex", "version": "0.99.0", "processes": 1, "activeSessions": 1}],
    "git": [{"project": "p_4d5e6f708192", "branch": "main",
             "commits": [{"t": "2026-11-17T09:48:00+09:00", "hash": "e1f2a3b", "title": "fix: handle empty mapping rule"}]}],
    "jobs": [{"name": "nightly-backup", "lastRun": "2026-11-17T03:00:05+09:00",
              "lastSuccess": "2026-11-17T03:00:05+09:00", "ok": True}],
}

# --- page example (private view) ---------------------------------------------
trend = []
for k in range(30):
    d = date(2026, 10, 19) + timedelta(days=k)
    cc = round(rnd.uniform(5, 45), 2)
    cx = round(rnd.uniform(0, 9), 2)
    trend.append({"date": d.isoformat(), "costUsd": {"claude-code": cc, "codex": cx},
                  "requests": int((cc + cx) * 26), "tokens": tok(0, 0, 0, 0, 0)})
trend[-1]["costUsd"] = {"claude-code": 41.2, "codex": 7.5}

days = []
start = date(2026, 11, 17) - timedelta(days=53 * 7 - 1)
for k in range(53 * 7):
    d = start + timedelta(days=k)
    gh = 0 if rnd.random() < 0.3 else rnd.randint(1, 30)
    gt = 0 if rnd.random() < 0.6 else rnd.randint(1, 8)
    lo = 0 if rnd.random() < 0.8 else rnd.randint(1, 4)
    days.append({"date": d.isoformat(), "count": gh + gt + lo, "github": gh, "gitea": gt, "local": lo})

page = {
    "schema": "glassbox.page/1", "view": "private", "generatedAt": iso(NOW), "tz": "Asia/Tokyo",
    "today": {
        "requests": 1284, "sessions": 23, "unpricedRequests": 0,
        "tokens": tok(3_420_000, 610_000, 41_800_000, 2_100_000, 180_000),
        "cacheHitRate": 0.887, "costUsd": 48.7,
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
                   for h, r in enumerate([0, 0, 0, 0, 0, 0, 0, 12, 88, 160, 140, 0] + [0] * 12)],
    },
    "trend": trend,
    "quota": [
        {"agent": "claude-code", "window": "7d", "usedPct": 41, "resetsAt": "2026-11-20T09:00:00+09:00", "sampledAt": iso(NOW),
         "history": [{"t": iso(NOW - timedelta(hours=12 * (14 - i))), "usedPct": p}
                     for i, p in enumerate([0, 3, 6, 9, 11, 14, 17, 20, 22, 25, 28, 31, 34, 37, 41])]},
        {"agent": "codex", "window": "5h", "usedPct": 55, "resetsAt": "2026-11-17T13:10:00+09:00", "sampledAt": iso(NOW),
         "history": [{"t": iso(NOW - timedelta(minutes=20 * (7 - i))), "usedPct": p}
                     for i, p in enumerate([0, 6, 13, 21, 30, 38, 46, 55])]},
        {"agent": "codex", "window": "7d", "usedPct": 70, "resetsAt": "2026-11-20T00:00:00+09:00", "sampledAt": iso(NOW), "history": []},
    ],
    "contributions": {"total": sum(d["count"] for d in days), "days": days},
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
        {"name": "falcon-ledger-api", "kind": "container", "machine": "C", "status": "up", "uptimePct24h": 99.3, "cpuPct": 2.1, "memBytes": 480e6},
        {"name": "status-page", "kind": "monitor", "machine": "C", "status": "down", "uptimePct24h": 96.5, "cpuPct": None, "memBytes": None},
    ],
    "runtimes": [
        {"machine": "A", "agent": "claude-code", "version": "2.1.326", "processes": 3, "activeSessions": 2},
        {"machine": "A", "agent": "codex", "version": "0.99.0", "processes": 1, "activeSessions": 1},
        {"machine": "B", "agent": "claude-code", "version": "2.1.320", "processes": 1, "activeSessions": 1},
    ],
    "tailnet": [{"name": "studio-dev", "os": "macos", "online": True, "lastSeen": iso(NOW)},
                {"name": "pocket-phone", "os": "ios", "online": False, "lastSeen": iso(NOW - timedelta(hours=5))}],
    "jobs": [{"name": "nightly-backup", "machine": "C", "lastRun": "2026-11-17T03:00:05+09:00",
              "lastSuccess": "2026-11-17T03:00:05+09:00", "ok": True}],
    "hidden": [],
}


# --- public view: the masking rules from CONTRACT.md §0.1 and §3 -------------
def masked(s):
    return {"masked": True, "len": max(4, min(16, len(s)))}


pub = copy.deepcopy(page)
pub["view"] = "public"
priv = [p for p in pub["today"]["byProject"] if not p["public"]]
pub["today"]["byProject"] = [p for p in pub["today"]["byProject"] if p["public"]] + [{
    "project": masked("private-projects"), "public": False,
    "requests": sum(p["requests"] for p in priv), "costUsd": round(sum(p["costUsd"] for p in priv), 2)}]
for a in pub["activity"]:
    if not a["public"]:
        a.update(repo=masked(a["repo"]), branch=None, hash=None, url=None)
        a["title"] = a["title"].replace("ACME-42", "******")   # keyword list lives in .local
for m in pub["machines"]:
    m["label"] = masked(m["label"])
for s in pub["services"]:
    if s["name"] not in ("gitea",):                             # allowlist lives in .local
        s["name"] = masked(s["name"])
for j in pub["jobs"]:
    j["name"] = masked(j["name"])
pub["tailnet"] = []
pub["hidden"] = ["tailnet"]

for name, obj in (("probe.json", probe), ("page.private.json", page), ("page.public.json", pub)):
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("wrote", name)

# --- self-check of the public invariants --------------------------------------
text = (OUT / "page.public.json").read_text(encoding="utf-8")
leaks = [s for s in ("falcon-ledger", "orchid-batch", "ACME-42", "studio-dev", "client-laptop",
                     "home-server", "garage-mbp", "pocket-phone", "nightly-backup", "gitea.example.org")
         if s in text]
assert not leaks, f"public example leaks: {leaks}"
assert all(a["hash"] is None and a["url"] is None for a in pub["activity"] if not a["public"])
print("public invariants ok")
