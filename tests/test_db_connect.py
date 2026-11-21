"""db.connect on a fresh database from several processes at once (the deploy starts `collect all`
and `serve` together): every opener must succeed. The first deploy showed serve exiting with
"database is locked" while switching the new file to WAL."""
import multiprocessing as mp
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from hub.db import SCHEMA_VERSION  # noqa: E402


def _open(path, barrier, q):
    from hub import db
    barrier.wait()
    try:
        conn = db.connect(path)
        q.put(("ok", conn.execute("PRAGMA journal_mode").fetchone()[0]))
        conn.close()
    except BaseException as e:  # SystemExit included
        q.put(("err", f"{type(e).__name__}: {e}"))


class ConcurrentFirstOpen(unittest.TestCase):
    def test_parallel_open_of_fresh_db(self):
        ctx = mp.get_context("spawn")
        for _ in range(5):                      # the race is timing dependent: several rounds
            with tempfile.TemporaryDirectory() as d:
                path = os.path.join(d, "hub.sqlite")
                n = 8
                barrier, q = ctx.Barrier(n, timeout=30), ctx.Queue()
                ps = [ctx.Process(target=_open, args=(path, barrier, q), daemon=True) for _ in range(n)]
                for p in ps:
                    p.start()
                res = [q.get(timeout=60) for _ in ps]
                for p in ps:
                    p.join(60)
                errors = [r[1] for r in res if r[0] != "ok"]
                self.assertEqual(errors, [], errors)
                self.assertEqual({r[1] for r in res}, {"wal"})
                conn = sqlite3.connect(path)
                self.assertEqual(conn.execute("SELECT v FROM kv WHERE k='schema_version'").fetchone()[0], SCHEMA_VERSION)
                conn.close()


class ExistingDatabase(unittest.TestCase):
    def test_schema_4_database_without_commit_files_opens_and_gains_it(self):
        """S17 R09 adds commit_files with CREATE TABLE IF NOT EXISTS and no schema bump: a live
        database from before opens as is, keeps its rows, and has the new table afterwards."""
        from hub import db
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "hub.sqlite")
            conn = db.connect(path)
            conn.execute("INSERT INTO machines(id) VALUES('A')")
            conn.execute("DROP TABLE commit_files")                   # as the live database is today
            conn.commit()
            conn.close()
            conn = db.connect(path)
            self.assertEqual(db.get(conn, "schema_version"), SCHEMA_VERSION)
            self.assertEqual(conn.execute("SELECT id FROM machines").fetchall(), [("A",)])
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM commit_files").fetchone()[0], 0)
            conn.close()


if __name__ == "__main__":
    unittest.main()
