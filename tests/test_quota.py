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

    # --- a reset inside a window: usage falls, the reset time stays ---------------------------------

    R = 999_999.0

    def env(self, rows):
        return [(x[0], x[2]) for x in quota._envelope([(t, "7d", float(v), self.R, *sid) for t, v, *sid in rows])]

    def test_low_news_that_lasts_is_a_reset(self):
        # a shows the fall and a minute later still reports low; b (idle) repeats the old value and is not read
        rows = [(100, 97, "a"), (110, 98, "b"), (120, 99, "a"), (200, 0, "a"), (210, 98, "b"), (300, 1, "a"),
                (330, 2, "c"), (340, 2, "b"), (350, 3, "b"), (360, 2, "a")]
        self.assertEqual(self.env(rows), [(100, 97.0), (110, 98.0), (120, 99.0), (210, 99.0), (300, 1.0), (340, 2.0),
                                          (350, 3.0), (360, 3.0)])

    def test_waking_session_showing_an_old_number_for_a_second_is_not_a_reset(self):
        # seen in real samples: c wakes on 11 while the account is at 18 and reports 18 a second later;
        # two sessions doing it at once make two low values in a row, still within the minute
        rows = [(100, 12, "c"), (110, 13, "d"), (200, 18, "a"), (210, 17, "a"), (220, 18, "a"),
                (1000, 11, "c"), (1001, 10, "d"), (1002, 18, "c"), (1003, 18, "d"), (1100, 19, "a")]
        self.assertEqual(self.env(rows), [(100, 12.0), (110, 13.0), (200, 18.0), (1100, 19.0)])

    def test_doubt_belongs_to_the_session_that_raised_it(self):
        # b showed a low number once and went quiet; hours later c wakes on an old number and corrects it.
        # Two low values from two sessions, any time apart, are not a reset.
        rows = [(0, 18, "a"), (5, 18, "b"), (6, 18, "c"), (100, 11, "b"), (7200, 12, "c"), (7201, 18, "c"), (7300, 19, "c")]
        self.assertEqual(self.env(rows), [(0, 18.0), (7300, 19.0)])

    def test_after_a_reset_a_session_from_before_it_must_last_to_be_believed(self):
        # o was last heard before the reset. Its high news is an old number (it corrects it a second later);
        # n, also from before, really reports a higher value twice, a minute apart
        rows = [(10, 99, "a"), (11, 99, "o"), (12, 90, "n"), (20, 0, "a"), (80, 1, "a"), (200, 97, "o"), (201, 1, "o"),
                (300, 30, "n"), (400, 31, "n"), (500, 32, "a")]
        self.assertEqual(self.env(rows), [(10, 99.0), (20, 99.0), (80, 1.0), (400, 31.0), (500, 32.0)])

    def test_low_values_seconds_apart_are_not_a_reset(self):
        # one session showing two old numbers within the minute, then the current one
        rows = [(100, 18, "a"), (110, 17, "c"), (1000, 11, "c"), (1005, 10, "c"), (1010, 18, "c"), (1100, 19, "a")]
        self.assertEqual(self.env(rows), [(100, 18.0), (1100, 19.0)])

    def test_after_a_reset_a_session_joins_the_new_run_with_news_near_it(self):
        # o comes from before the reset; once it has reported a value near the new maximum it is believed at once
        rows = [(10, 99, "a"), (11, 99, "o"), (20, 0, "a"), (80, 1, "a"), (200, 2, "o"), (300, 40, "o")]
        self.assertEqual(self.env(rows), [(10, 99.0), (20, 99.0), (80, 1.0), (200, 2.0), (300, 40.0)])

    def test_news_near_the_maximum_ends_the_doubt(self):
        # a low value, then news at the maximum, then a low value more than a minute after the first: no reset
        rows = [(100, 50, "a"), (110, 49, "b"), (200, 30, "b"), (230, 51, "a"), (300, 29, "b"), (310, 52, "a")]
        self.assertEqual(self.env(rows), [(100, 50.0), (230, 51.0), (310, 52.0)])

    def test_new_session_after_the_reset_is_followed_however_late_the_old_one_wakes(self):
        # the usual case: the user resets and starts a new session; its first number is not news, the next two are
        rows = [(100, 99, "a"), (1000, 1, "c"), (3000, 10, "c"), (5000, 20, "c"), (5100, 20, "a"), (6000, 30, "c"), (9000, 45, "c")]
        self.assertEqual(self.env(rows), [(100, 99.0), (3000, 99.0), (5000, 20.0), (6000, 30.0), (9000, 45.0)])

    def test_idle_session_with_news_after_the_reset_counts(self):
        # b sat at 50 while the account went to 99; after the reset it reports 48: below 99, though not below its own 50
        rows = [(10, 50, "b"), (20, 99, "a"), (200, 48, "b"), (300, 60, "b"), (400, 62, "b")]
        self.assertEqual(self.env(rows), [(10, 50.0), (20, 99.0), (200, 99.0), (300, 60.0), (400, 62.0)])

    def test_first_samples_and_repeats_never_lower_the_window(self):
        # resumed sessions open on old numbers, any number of them, and repeat them for minutes: no reset
        rows = [(100, 60, "a"), (200, 30, "x"), (250, 30, "x"), (300, 61, "z"), (400, 25, "y"), (500, 10), (600, 9)]      # last two: no id
        self.assertEqual(self.env(rows), [(100, 60.0), (300, 61.0), (600, 61.0)])

    def test_after_a_reset_only_news_is_read(self):
        # numbers from before the reset keep arriving: sessions opening on 98 (two of them, the same number),
        # one repeating it, a sample without a session id, and one waking on 97 for a second. None is taken.
        rows = [(100, 99, "a"), (110, 99, "o"), (200, 0, "a"), (300, 3, "a"), (400, 98, "n"), (410, 98, "m"), (420, 98, "n"), (430, 98),
                (440, 97, "o"), (441, 3, "o"), (500, 4, "a"), (510, 4, "n"), (600, 5, "a")]
        self.assertEqual(self.env(rows), [(100, 99.0), (200, 99.0), (300, 3.0), (500, 4.0), (600, 5.0)])

    def test_after_a_reset_a_jump_from_a_session_of_the_new_run_is_taken_at_once(self):
        # used on another machine: a's next news is far above. a was heard after the reset, so it is not an old number
        rows = [(100, 99, "a"), (200, 0, "a"), (300, 3, "a"), (1000, 40, "a"), (1100, 41, "a"), (1200, 42, "a")]
        self.assertEqual(self.env(rows), [(100, 99.0), (200, 99.0), (300, 3.0), (1000, 40.0), (1100, 41.0), (1200, 42.0)])

    def test_before_any_reset_a_first_sample_or_a_jump_raises_the_window_at_once(self):
        rows = [(100, 20, "a"), (200, 55, "n"), (300, 70), (400, 90, "a")]         # used elsewhere overnight; no id; news
        self.assertEqual(self.env(rows), [(100, 20.0), (200, 55.0), (300, 70.0), (400, 90.0)])

    def test_two_resets_in_one_window(self):
        rows = [(100, 80, "a"), (200, 0, "a"), (300, 1, "a"), (400, 40, "a"), (500, 41, "a"), (600, 0, "a"), (700, 2, "a")]
        self.assertEqual(self.env(rows), [(100, 80.0), (200, 80.0), (300, 1.0), (400, 40.0), (500, 41.0), (600, 41.0), (700, 2.0)])

    def test_one_point_a_second_and_the_newer_wins(self):
        # the hub keeps the first row it gets for a second: the point after the reset must be the one sent
        rows = [(100, 99, "a"), (200, 0, "a"), (300.2, 99, "b"), (300.7, 1, "a")]
        self.assertEqual(self.env(rows), [(100, 99.0), (300.7, 1.0)])

    def test_windows_do_not_mix(self):
        s = [(100, "7d", 90.0, self.R, "a"), (110, "5h", 10.0, 5000.0, "a"), (120, "5h", 12.0, 5000.0, "a"), (130, "7d", 91.0, self.R, "a")]
        self.assertEqual([(x[1], x[2]) for x in quota._envelope(s)], [("7d", 90.0), ("5h", 10.0), ("5h", 12.0), ("7d", 91.0)])

    def test_claude_samples_follow_a_reset(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "s.jsonl"
            rows = [(100, "x", 99), (200, "y", 99), (300, "x", 0), (400, "y", 99), (500, "x", 6), (600, "x", 7)]
            p.write_text("".join(json.dumps({"ts": t, "sample": {"s": sid, "r": {
                "seven_day": {"used_percentage": v, "resets_at": 999_999}}}}) + "\n" for t, sid, v in rows))
            self.assertEqual([x[2] for x in quota.claude_samples([p], since=0)], [99.0, 99.0, 6.0, 7.0])   # the second 99 closes the old run

    def test_codex_transcript_is_one_session(self):
        with tempfile.TemporaryDirectory() as d:
            for name, rows in (("a.jsonl", [("2026-11-17T01:00:00Z", 90), ("2026-11-17T03:00:00Z", 2), ("2026-11-17T04:00:00Z", 8), ("2026-11-17T05:00:00Z", 9)]),
                               ("b.jsonl", [("2026-11-17T03:30:00Z", 90)])):
                (Path(d) / name).write_text("".join(json.dumps({"timestamp": ts, "payload": {"rate_limits": {"secondary": {
                    "window_minutes": 10080, "used_percent": v, "resets_at": 1_900_000_000}}}}) + "\n" for ts, v in rows))
            self.assertEqual([x[2] for x in quota.codex_samples([d], since=0)], [90.0, 90.0, 8.0, 9.0])     # b.jsonl repeats 90 and is not read

    def test_account_code_is_salted_and_short(self):
        a = quota.account_code("user-123", "salt1")
        self.assertRegex(a, r"^a_[0-9a-f]{8}$")
        self.assertNotEqual(a, quota.account_code("user-123", "salt2"))


if __name__ == "__main__":
    unittest.main()
