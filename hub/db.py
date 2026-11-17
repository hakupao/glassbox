"""The hub's sqlite store. One file inside the deploy volume (default ~/.glassbox/hub.sqlite)."""
import sqlite3
from pathlib import Path

SCHEMA_VERSION = "4"   # bump on any table change; an older database refuses to open (no silent breakage)

SCHEMA = """
CREATE TABLE IF NOT EXISTS machines (
  id TEXT PRIMARY KEY, token_sha TEXT UNIQUE, role TEXT, os TEXT, label TEXT,
  last_report REAL, probe_version TEXT, rebaseline_until REAL
);
CREATE TABLE IF NOT EXISTS usage (
  machine TEXT, hour TEXT, agent TEXT, model TEXT, project TEXT,
  requests INTEGER, unpriced INTEGER, input INTEGER, output INTEGER, cache_read INTEGER,
  cache_write INTEGER, reasoning INTEGER, cost REAL,
  PRIMARY KEY (machine, hour, agent, model, project)
);
CREATE INDEX IF NOT EXISTS usage_hour ON usage(hour);
CREATE TABLE IF NOT EXISTS sessions (
  machine TEXT, hour TEXT, agent TEXT, project TEXT, count INTEGER,
  PRIMARY KEY (machine, hour, agent, project)
);
-- visibility NULL means "not checked yet" and is treated as private everywhere.
-- owner: the machine a remote-less project belongs to.
CREATE TABLE IF NOT EXISTS projects (
  key TEXT PRIMARY KEY, name TEXT, remote TEXT, visibility TEXT, checked REAL, owner TEXT
);
CREATE TABLE IF NOT EXISTS quota (
  account TEXT, agent TEXT, window TEXT, sampled_at TEXT, used_pct REAL, resets_at TEXT, machine TEXT,
  PRIMARY KEY (account, agent, window, sampled_at)
);
CREATE TABLE IF NOT EXISTS runtimes (
  machine TEXT, agent TEXT, version TEXT, processes INTEGER, active INTEGER, reported REAL,
  PRIMARY KEY (machine, agent)
);
CREATE TABLE IF NOT EXISTS jobs (
  machine TEXT, name TEXT, last_run TEXT, last_success TEXT, ok INTEGER, reported REAL,
  PRIMARY KEY (machine, name)
);
-- Commits from every source. One row per (source, hash, machine); machine is '' for github
-- and gitea. The page dedups by hash with priority github > gitea > local (CONTRACT §2.1).
CREATE TABLE IF NOT EXISTS commits (
  source TEXT, hash TEXT, machine TEXT, t TEXT, repo TEXT, remote TEXT, project TEXT, branch TEXT,
  title TEXT, url TEXT, pushed INTEGER, private INTEGER,
  PRIMARY KEY (source, hash, machine)
);
CREATE INDEX IF NOT EXISTS commits_t ON commits(t);
CREATE TABLE IF NOT EXISTS machine_state (machine TEXT PRIMARY KEY, status TEXT, uptime INTEGER, updated REAL);
CREATE TABLE IF NOT EXISTS machine_stats (
  machine TEXT, t TEXT, cpu REAL, mem_used REAL, mem_total REAL, disk_used REAL, disk_total REAL,
  PRIMARY KEY (machine, t)
);
-- One table per source; each source replaces its table after a successful run.
CREATE TABLE IF NOT EXISTS container_stats (machine TEXT, name TEXT, cpu REAL, mem REAL, PRIMARY KEY (machine, name));
CREATE TABLE IF NOT EXISTS container_state (machine TEXT, name TEXT, status TEXT, PRIMARY KEY (machine, name));
CREATE TABLE IF NOT EXISTS monitors (id TEXT PRIMARY KEY, name TEXT, machine TEXT, status TEXT, uptime24 REAL);
CREATE TABLE IF NOT EXISTS tailnet (name TEXT PRIMARY KEY, os TEXT, online INTEGER, last_seen TEXT);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS warnings (t REAL, machine TEXT, kind TEXT, detail TEXT);
"""


def connect(path):
    path = Path(path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    fresh = not conn.execute("SELECT 1 FROM sqlite_master WHERE name='kv'").fetchone()
    conn.executescript(SCHEMA)
    v = get(conn, "schema_version")
    if fresh or v is None and not conn.execute("SELECT 1 FROM machines").fetchone():
        put(conn, "schema_version", SCHEMA_VERSION)
        conn.commit()
    elif v != SCHEMA_VERSION:
        raise SystemExit(f"hub database schema {v} != {SCHEMA_VERSION}; migrate or start from a new database")
    return conn


def get(conn, k, default=None):
    row = conn.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
    return row[0] if row else default


def put(conn, k, v):
    conn.execute("INSERT INTO kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, v))
