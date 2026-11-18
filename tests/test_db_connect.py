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


if __name__ == "__main__":
    unittest.main()
