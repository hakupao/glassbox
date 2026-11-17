"""The probe's local state: a sqlite file outside the repo (default ~/.glassbox/probe.sqlite)."""
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY, agent TEXT, mtime REAL, size INTEGER, offset INTEGER,
  born REAL, state TEXT
);
-- One row per API request after global de-duplication (CONTRACT §1.1, PLAN §4).
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY, agent TEXT, ts TEXT, model TEXT, session TEXT, cwd TEXT, born REAL,
  input INTEGER, output INTEGER, cache_read INTEGER, cache_write5m INTEGER, cache_write1h INTEGER,
  reasoning INTEGER, cost REAL
);
CREATE INDEX IF NOT EXISTS requests_ts ON requests(ts);
CREATE TABLE IF NOT EXISTS projects (cwd TEXT PRIMARY KEY, key TEXT, name TEXT, remote TEXT, checked REAL);
"""


def connect(path):
    path = Path(path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.executescript(SCHEMA)
    return conn


def get_meta(conn, k, default=None):
    row = conn.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
    return row[0] if row else default


def set_meta(conn, k, v):
    conn.execute("INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, v))


# Keep the finished response: the copy with the largest output wins (ties: the newest
# copy). The owning session and cwd come from the earliest-created file, because resumed
# and subagent transcripts replay other files' history.
UPSERT = """
INSERT INTO requests (id, agent, ts, model, session, cwd, born, input, output, cache_read,
                      cache_write5m, cache_write1h, reasoning, cost)
VALUES (:id, :agent, :ts, :model, :session, :cwd, :born, :input, :output, :cache_read,
        :cache_write5m, :cache_write1h, :reasoning, :cost)
ON CONFLICT(id) DO UPDATE SET
  ts            = CASE WHEN excluded.output >= output THEN excluded.ts ELSE ts END,
  model         = CASE WHEN excluded.output >= output THEN excluded.model ELSE model END,
  input         = CASE WHEN excluded.output >= output THEN excluded.input ELSE input END,
  cache_read    = CASE WHEN excluded.output >= output THEN excluded.cache_read ELSE cache_read END,
  cache_write5m = CASE WHEN excluded.output >= output THEN excluded.cache_write5m ELSE cache_write5m END,
  cache_write1h = CASE WHEN excluded.output >= output THEN excluded.cache_write1h ELSE cache_write1h END,
  reasoning     = CASE WHEN excluded.output >= output THEN excluded.reasoning ELSE reasoning END,
  cost          = CASE WHEN excluded.output >= output THEN excluded.cost ELSE cost END,
  session       = CASE WHEN excluded.born < born THEN excluded.session ELSE session END,
  cwd           = CASE WHEN excluded.born < born THEN excluded.cwd ELSE cwd END,
  born          = MIN(excluded.born, born),
  output        = MAX(excluded.output, output)
"""
