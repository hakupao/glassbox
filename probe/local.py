"""Local facts for glassbox.probe/1: git commits, agent runtimes and scheduled jobs (CONTRACT §1).

git: each repository directly under the configured `git_roots` (and the roots themselves if
they are repositories). Only commits by the configured author e-mails are reported, as a
snapshot of the last `git_days` days; the e-mails themselves are never reported.
"""
import platform
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

from . import projects

UTC = timezone.utc
SEP = "\x1f"
# Commit titles are free text; scrub absolute paths before they leave the machine (CONTRACT §1.2).
PATHS = re.compile(r"(?:/Users/|/home/|/Volumes/|[A-Za-z]:\\Users\\)[^\s'\"`)]*")


def scrub(title):
    return PATHS.sub("<path>", title)


def _run(args, cwd=None, timeout=20):
    try:
        r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout,
                           encoding="utf-8", errors="replace")
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout if r.returncode == 0 else None


def _zulu_from_iso(s):
    return datetime.fromisoformat(s).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _repos(roots):
    seen = set()
    for root in roots:
        root = Path(root).expanduser()
        cands = [root] + (sorted(p for p in root.iterdir() if p.is_dir()) if root.is_dir() else [])
        for c in cands:
            if (c / ".git").exists() and c.resolve() not in seen:
                seen.add(c.resolve())
                yield c


def git_activity(conn, cfg):
    emails = [e.lower() for e in cfg.get("author_emails", [])]
    if not emails:
        return [], {}
    days = int(cfg.get("git_days", 60))
    out, used = [], {}
    for repo in _repos(cfg.get("git_roots", [])):
        args = ["git", "-C", str(repo), "log", "--all", "--source", f"--since={days}.days",
                f"--format=%H{SEP}%aI{SEP}%ae{SEP}%S{SEP}%s"]
        log = _run(args)
        if not log:
            continue
        unpushed = set((_run(["git", "-C", str(repo), "rev-list", "--all", "--not", "--remotes"]) or "").split())
        commits = []
        for line in log.splitlines():
            parts = line.split(SEP)
            if len(parts) != 5 or parts[2].lower() not in emails:
                continue
            h, t, _, src, title = parts
            branch = re.sub(r"^refs/(heads|remotes/[^/]+|tags)/", "", src) if src else None
            commits.append({"t": _zulu_from_iso(t), "hash": h, "branch": branch or None,
                            "title": scrub(title)[:300], "pushed": h not in unpushed})
        if not commits:
            continue
        key, name, remote = projects.resolve(conn, str(repo), cfg["machine"], cfg.get("ssh_aliases"))
        used[key] = {"name": name, "remote": remote}
        out.append({"project": key, "remote": remote is not None, "commits": commits})
    conn.commit()
    return out, used


# ------------------------------------------------------------------------------ runtimes
AGENTS = {"claude-code": ("claude", ["claude", "--version"]), "codex": ("codex", ["codex", "--version"])}


def _process_names():
    """Executable base names only: matching on arguments counts unrelated helpers."""
    if platform.system() == "Windows":
        out = _run(["tasklist", "/fo", "csv", "/nh"]) or ""
        names = [l.split('","')[0].strip('"') for l in out.splitlines() if l]
    else:
        out = _run(["ps", "-axo", "comm="]) or ""
        names = [l.strip() for l in out.splitlines()]
    return [re.sub(r"\.(exe|cmd)$", "", n.replace("\\", "/").rsplit("/", 1)[-1].lower()) for n in names]


def _count_procs(names, exe):
    return sum(1 for n in names if n == exe)


def _recent_transcripts(roots, within):
    now, n = time.time(), 0
    for root in roots:
        root = Path(root).expanduser()
        if not root.is_dir():
            continue
        for f in root.rglob("*.jsonl"):
            if "subagents" in f.parts:
                continue
            try:
                if now - f.stat().st_mtime < within:
                    n += 1
            except OSError:
                pass
    return n


def runtimes(cfg):
    names = _process_names()
    out = []
    for agent, (exe, version_cmd) in AGENTS.items():
        v = _run(version_cmd, timeout=10)
        m = re.search(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", v or "")
        if not m and not _count_procs(names, exe):
            continue                                  # not installed here
        roots = cfg["claude_roots"] if agent == "claude-code" else cfg["codex_roots"]
        out.append({"agent": agent, "version": m.group(0) if m else None,
                    "processes": _count_procs(names, exe),
                    "activeSessions": _recent_transcripts(roots, 600)})
    return out


# ------------------------------------------------------------------------------ jobs
def jobs(cfg):
    """cfg["jobs"]: [{name, path, ok = "regex found in the last 4 KB means success"}].
    lastRun is the file's mtime; lastSuccess is lastRun when `ok` matches (or no `ok` given)."""
    out = []
    for j in cfg.get("jobs", []):
        p = Path(j["path"]).expanduser()
        try:
            st = p.stat()
        except OSError:
            out.append({"name": j["name"], "lastRun": None, "lastSuccess": None, "ok": False})
            continue
        last = datetime.fromtimestamp(st.st_mtime, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        ok = True
        if j.get("ok"):
            with open(p, "rb") as fh:
                fh.seek(max(0, st.st_size - 4096))
                ok = re.search(j["ok"], fh.read().decode("utf-8", "replace")) is not None
        out.append({"name": j["name"], "lastRun": last, "lastSuccess": last if ok else None, "ok": ok})
    return out
