"""The hub's sqlite store. One file inside the deploy volume (default ~/.glassbox/hub.sqlite)."""
import sqlite3
from pathlib import Path

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
CREATE TABLE IF NOT EXISTS projects (
  key TEXT PRIMARY KEY, name TEXT, remote TEXT, visibility TEXT, checked REAL
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
-- Commits from every source. One row per (source, hash); the page dedups by hash with
-- priority github > gitea > local (CONTRACT §2.1).
CREATE TABLE IF NOT EXISTS commits (
  source TEXT, hash TEXT, t TEXT, repo TEXT, remote TEXT, project TEXT, branch TEXT, title TEXT,
  url TEXT, machine TEXT, pushed INTEGER, private INTEGER,
  PRIMARY KEY (source, hash)
);
CREATE INDEX IF NOT EXISTS commits_t ON commits(t);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS warnings (t REAL, machine TEXT, kind TEXT, detail TEXT);
"""


def connect(path):
    path = Path(path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.executescript(SCHEMA)
    return conn


def get(conn, k, default=None):
    row = conn.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
    return row[0] if row else default


def put(conn, k, v):
    conn.execute("INSERT INTO kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, v))
