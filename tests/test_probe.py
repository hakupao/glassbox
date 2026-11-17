"""Unit tests for the probe's parsing rules (PLAN §4), on fabricated transcripts only.

    python3 -m unittest discover -s tests
"""
import json
import os
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

from probe import logs, pricing, projects, report, state


def claude(mid, out, ts="2026-11-16T10:00:00.000Z", session="s1", cwd="/tmp/nowhere", **usage):
    u = {"input_tokens": 10, "output_tokens": out, "cache_read_input_tokens": 1000,
         "cache_creation_input_tokens": 200,
         "cache_creation": {"ephemeral_5m_input_tokens": 50, "ephemeral_1h_input_tokens": 150}}
    u.update(usage)
    return {"type": "assistant", "timestamp": ts, "sessionId": session, "cwd": cwd, "requestId": "req_" + mid,
            "message": {"id": mid, "model": "claude-opus-5-5", "usage": u}}


def codex_file(session, records):
    head = [{"type": "session_meta", "timestamp": "2026-11-16T00:00:00Z",
             "payload": {"id": session, "session_id": session, "cwd": "/tmp/nowhere"}},
            {"type": "turn_context", "timestamp": "2026-11-16T00:00:01Z", "payload": {"model": "gpt-6-astra"}}]
    return head + records


def tur(resp, ts, inp=1000, cached=900, out=50, reasoning=10):
    return {"type": "token_usage_record", "timestamp": ts,
            "payload": {"response_id": resp, "usage": {"input_tokens": inp, "cached_input_tokens": cached,
                                                        "cache_write_input_tokens": 0, "output_tokens": out,
                                                        "reasoning_output_tokens": reasoning}}}


class ProbeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "claude").mkdir()
        (self.root / "codex").mkdir()
        self.conn = state.connect(self.root / "state.sqlite")

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def write(self, rel, records, born_delay=0.0):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        if born_delay:
            time.sleep(born_delay)
        p.write_text("".join(json.dumps(r) + "\n" for r in records), encoding="utf-8")
        return p

    def scan(self):
        return logs.scan(self.conn, [self.root / "claude"], [self.root / "codex"])

    def req(self, rid):
        cur = self.conn.execute("SELECT * FROM requests WHERE id=?", (rid,))
        cols = [c[0] for c in cur.description]
        row = cur.fetchone()
        return dict(zip(cols, row)) if row else None

    # --- Claude -------------------------------------------------------------------
    def test_duplicate_lines_count_once(self):
        self.write("claude/p/a.jsonl", [claude("m1", 5), claude("m1", 5), claude("m1", 5)])
        self.scan()
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM requests").fetchone()[0], 1)

    def test_largest_output_wins_across_files_and_owner_is_oldest_file(self):
        self.write("claude/p/orig.jsonl", [claude("m1", 7, session="orig")])
        # A resumed transcript replays a mid-stream snapshot (smaller output) under a new session.
        self.write("claude/p/resumed.jsonl", [claude("m1", 3, session="resumed")], born_delay=1.1)
        self.scan()
        r = self.req("c:m1")
        self.assertEqual(r["output"], 7)
        self.assertEqual(r["session"], "orig")

    def test_cache_split_and_cost(self):
        self.write("claude/p/a.jsonl", [claude("m1", 100)])
        self.scan()
        r = self.req("c:m1")
        self.assertEqual((r["cache_write5m"], r["cache_write1h"]), (50, 150))
        expect = (10 * 4 + 100 * 20 + 1000 * 0.20 + 50 * 5 + 150 * 8) / 1e6
        self.assertAlmostEqual(r["cost"], expect, places=12)

    def test_advisor_iteration_counted_separately_under_its_model(self):
        rec = claude("m1", 30, iterations=[
            {"type": "message", "input_tokens": 5, "output_tokens": 10},
            {"type": "advisor_message", "model": "claude-fable-5-1", "input_tokens": 1000, "output_tokens": 99,
             "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0},
            {"type": "message", "input_tokens": 5, "output_tokens": 20}])
        self.write("claude/p/a.jsonl", [rec])
        self.scan()
        self.assertEqual(self.req("c:m1")["output"], 30)
        adv = self.req("c:m1#advisor_message1")
        self.assertEqual((adv["model"], adv["input"], adv["output"]), ("claude-fable-5-1", 1000, 99))

    def test_fast_mode_model_and_unpriced_cache(self):
        self.write("claude/p/a.jsonl", [claude("m1", 10, speed="fast")])
        self.scan()
        r = self.req("c:m1")
        self.assertEqual(r["model"], "claude-opus-5-5:fast")
        self.assertIsNone(r["cost"])            # fast-mode cache prices are not published

    def test_incremental_read_skips_partial_line(self):
        p = self.root / "claude/p/a.jsonl"
        p.parent.mkdir(parents=True)
        line = json.dumps(claude("m1", 5)) + "\n"
        p.write_text(line + json.dumps(claude("m2", 5))[:40], encoding="utf-8")
        self.scan()
        self.assertIsNotNone(self.req("c:m1"))
        self.assertIsNone(self.req("c:m2"))
        p.write_text(line + json.dumps(claude("m2", 5)) + "\n", encoding="utf-8")
        os.utime(p, None)
        self.scan()
        self.assertIsNotNone(self.req("c:m2"))

    # --- Codex --------------------------------------------------------------------
    def test_codex_input_excludes_cached_and_fork_dedups(self):
        recs = [tur("r1", "2026-11-16T01:00:00Z"), tur("r2", "2026-11-16T01:05:00Z")]
        self.write("codex/a.jsonl", codex_file("t1", recs))
        self.write("codex/fork.jsonl", codex_file("t2", recs[:1] + [tur("r3", "2026-11-16T02:00:00Z")]))
        self.scan()
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM requests WHERE agent='codex'").fetchone()[0], 3)
        r = self.req("x:r1")
        self.assertEqual((r["input"], r["cache_read"], r["output"], r["reasoning"], r["model"]),
                         (100, 900, 50, 10, "gpt-6-astra"))

    def test_codex_old_format_uses_last_token_usage_not_totals(self):
        ev = lambda ts, total, last: {"type": "event_msg", "timestamp": ts, "payload": {
            "type": "token_count", "info": {"total_token_usage": {"input_tokens": total, "output_tokens": total},
                                             "last_token_usage": {"input_tokens": last, "output_tokens": 1}}}}
        self.write("codex/old.jsonl", codex_file("t9", [ev("2026-11-16T01:00:00Z", 100, 100),
                                                         ev("2026-11-16T01:01:00Z", 250, 150)]))
        self.scan()
        total = self.conn.execute("SELECT SUM(input) FROM requests WHERE agent='codex'").fetchone()[0]
        self.assertEqual(total, 250)

    # --- report -------------------------------------------------------------------
    def test_report_sessions_count_once_and_rows_by_hour(self):
        self.write("claude/p/a.jsonl", [claude("m1", 5, ts="2026-11-16T10:10:00Z"),
                                        claude("m2", 5, ts="2026-11-16T11:20:00Z")])
        self.scan()
        body = report.usage(self.conn, "A", days=3, now=datetime(2026, 11, 16, 12, 0, tzinfo=timezone.utc))
        self.assertEqual([r["hourStart"] for r in body["usage"]["rows"]],
                         ["2026-11-16T10:00:00Z", "2026-11-16T11:00:00Z"])
        self.assertEqual(sum(s["count"] for s in body["usage"]["sessions"]), 1)
        refs = {r["project"] for r in body["usage"]["rows"]}
        self.assertTrue(refs <= set(body["projects"]))
        self.assertNotIn("/tmp", json.dumps(body))         # no paths leave the machine


class UnitTest(unittest.TestCase):
    def test_normalize_remote(self):
        n = projects.normalize_remote
        self.assertEqual(n("https://user:tok@GitHub.com:443/owner/repo.git"), "github.com/owner/repo")
        self.assertEqual(n("git@github.com:owner/repo.git"), "github.com/owner/repo")
        self.assertEqual(n("ssh://git@gitea.example.org:2222/team/app.git"), "gitea.example.org/team/app")
        self.assertEqual(n("git@work-gh:owner/repo", {"work-gh": "github.com"}), "github.com/owner/repo")

    def test_pricing_long_context_and_unknown(self):
        small = {"input": 1000, "output": 0, "cache_read": 0, "cache_write5m": 0, "cache_write1h": 0}
        big = dict(small, input=200_000)
        self.assertAlmostEqual(pricing.cost("claude-haiku-5-5", small), 1000 * 0.10 / 1e6)
        self.assertAlmostEqual(pricing.cost("claude-haiku-5-5", big), 200_000 * 0.50 / 1e6)
        self.assertIsNone(pricing.cost("made-up-model", small))

    def test_base_model(self):
        self.assertEqual(logs._base_model("claude-haiku-4-5-20251001"), "claude-haiku-4-5")
        self.assertEqual(logs._base_model("arn:aws:bedrock:us-east-1:123:inference-profile/x"), "x")
        self.assertEqual(logs._base_model(None), "other")


if __name__ == "__main__":
    unittest.main()
