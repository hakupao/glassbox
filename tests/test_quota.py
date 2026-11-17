"""Quota sampling rules on fabricated samples."""
import json
import tempfile
import unittest
from pathlib import Path

from probe import quota


class QuotaTest(unittest.TestCase):
    def test_stale_lower_sample_does_not_lower_the_window(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "s.jsonl"
            rows = [(100, 6), (200, 3), (300, 6), (400, 7)]            # an idle session reports 3% late
            p.write_text("".join(json.dumps({"ts": t, "sample": {"s": "x", "r": {
                "seven_day": {"used_percentage": v, "resets_at": 999_999}}}}) + "\n" for t, v in rows))
            out = quota.claude_samples([p], since=0)
            self.assertEqual([x[2] for x in out], [6.0, 7.0])
            self.assertTrue(all(x[1] == "7d" for x in out))

    def test_new_window_starts_fresh(self):
        s = [(1, "5h", 80.0, 1000.0), (2, "5h", 5.0, 20000.0)]
        self.assertEqual([x[2] for x in quota._envelope(s)], [80.0, 5.0])

    def test_account_code_is_salted_and_short(self):
        a = quota.account_code("user-123", "salt1")
        self.assertRegex(a, r"^a_[0-9a-f]{8}$")
        self.assertNotEqual(a, quota.account_code("user-123", "salt2"))


if __name__ == "__main__":
    unittest.main()
