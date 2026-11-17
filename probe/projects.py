"""Map a working directory to a stable project key (CONTRACT §1.1 "项目键").

The cwd itself never leaves this machine; only the key, the repo name and the
normalized remote are reported.
"""
import hashlib
import os
import re
import subprocess
import time
from pathlib import Path

OTHER = "p_other"
RECHECK = 24 * 3600


def _key(text):
    return "p_" + hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def _git(args, cwd):
    try:
        r = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def normalize_remote(url, aliases=None):
    """Return host/owner/repo, all lower case (GitHub and Gitea paths are case-insensitive):
    no scheme, credentials, port or .git; ssh host aliases mapped back to the real host."""
    if not url:
        return None
    u = url.strip()
    m = re.match(r"^[a-z][a-z0-9+.-]*://(?:[^@/]*@)?([^/:]+)(?::\d+)?/(.+)$", u, re.I)
    if not m:
        m = re.match(r"^(?:[^@/]+@)?([^/:]+):(.+)$", u)          # scp-like: git@host:owner/repo
    if not m:
        return None
    host, path = m.group(1).lower(), m.group(2)
    host = (aliases or {}).get(host, host).lower()
    path = re.sub(r"\.git/?$", "", path.strip("/"))
    return f"{host}/{path}".lower() if path else None


def _existing(cwd):
    p = Path(cwd)
    while not p.exists() and p != p.parent:
        p = p.parent
    return p


def resolve(conn, cwd, machine, aliases=None):
    """Return (key, name, remote) for a cwd, cached in the projects table."""
    if not cwd:
        return OTHER, "other", None
    row = conn.execute("SELECT key, name, remote, checked FROM projects WHERE cwd=?", (cwd,)).fetchone()
    if row and time.time() - row[3] < RECHECK:
        return row[:3]
    base = _existing(cwd)
    top = _git(["rev-parse", "--show-toplevel"], str(base)) if base.exists() and str(base) != os.sep else None
    if not top or (Path(top) == Path.home()):
        key, name, remote = OTHER, "other", None
    else:
        remote = normalize_remote(_git(["config", "--get", "remote.origin.url"], top), aliases)
        name = remote.rsplit("/", 1)[-1] if remote else Path(top).name
        key = _key(remote) if remote else _key(f"{machine}\0{Path(top).name}")
    conn.execute("INSERT INTO projects(cwd, key, name, remote, checked) VALUES(?,?,?,?,?) "
                 "ON CONFLICT(cwd) DO UPDATE SET key=excluded.key, name=excluded.name, "
                 "remote=excluded.remote, checked=excluded.checked", (cwd, key, name, remote, time.time()))
    return key, name, remote
