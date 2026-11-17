"""Red-team samples for the publish gate (S12): every block-* sample must be rejected for the
stated reason, every pass-* sample must pass. All data is fabricated; see tests/redteam/."""
import importlib.util
import json
import re
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RT = ROOT / "tests" / "redteam"
_spec = importlib.util.spec_from_file_location("verify_public", ROOT / "scripts" / "verify_public.py")
vp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vp)

# Values the repo's own privacy scan would flag are assembled here, not stored in the samples.
PLACEHOLDERS = {"{{USERS}}": "/" + "Users/", "{{HOMEDIR}}": "/" + "home/", "{{GHP}}": "ghp" + "_" + "A1b2C3d4" * 5}


def context():
    terms = json.loads((RT / "context" / "terms.json").read_text(encoding="utf-8"))
    ctx = json.loads((RT / "context" / "gate-context.json").read_text(encoding="utf-8"))
    cfg = vp.load_toml(RT / "context" / "public.toml")
    return terms, ctx, cfg


def materialise(case, d):
    text = (RT / "samples" / case["file"]).read_text(encoding="utf-8")
    for k, v in PLACEHOLDERS.items():
        text = text.replace(k, v)
    out = Path(d) / case["file"]
    out.write_text(text, encoding="utf-8")
    return out


class RedTeamTest(unittest.TestCase):
    def setUp(self):
        self.terms, self.ctx, self.cfg = context()
        self.gate = vp.Gate(self.terms, self.ctx, self.cfg)
        self.cases = json.loads((RT / "cases.json").read_text(encoding="utf-8"))

    def test_every_sample_listed(self):
        files = {p.name for p in (RT / "samples").iterdir()}
        self.assertEqual(files, {c["file"] for c in self.cases})

    def test_cases(self):
        with tempfile.TemporaryDirectory() as d:
            for case in self.cases:
                with self.subTest(case["file"]):
                    problems = self.gate.check_file(materialise(case, d))
                    if case["expect"] == "pass":
                        self.assertEqual(problems, [], case["why"])
                    else:
                        self.assertTrue(problems, f"not blocked: {case['why']}")
                        self.assertTrue(any(case["reason"] in p for p in problems),
                                        f"blocked for another reason: {problems}")

    def test_block_rate_is_total(self):
        blocks = [c for c in self.cases if c["expect"] == "block"]
        self.assertGreaterEqual(len(blocks), 50)
        self.assertGreaterEqual(sum(c["expect"] == "pass" for c in self.cases), 3)
        with tempfile.TemporaryDirectory() as d:
            caught = sum(bool(self.gate.check_file(materialise(c, d))) for c in blocks)
        self.assertEqual(caught, len(blocks))

    def test_reasons_never_echo_private_words(self):
        words = list(self.terms["terms"]) + self.cfg["keywords"] + [
            n for n in self.ctx["privateNames"] if vp.norm(n) not in vp.vocabulary()] + list(PLACEHOLDERS.values())
        with tempfile.TemporaryDirectory() as d:
            report = "\n".join(p for c in self.cases for p in self.gate.check_file(materialise(c, d)))
        # File names are ours; drop them so only the reason text is searched.
        report = re.sub(r"\S+\.(?:json|html)", "", report)
        for w in words:
            pat = r"(?<![A-Za-z0-9_])" + re.escape(w) + r"(?![A-Za-z0-9_])" if len(vp.norm(w)) < 5 else re.escape(w)
            self.assertIsNone(re.search(pat, report, re.I), f"report echoes {vp.hide(w)}")
        for secret in ("ops@example.com", "203.0.113.7", "AKIAIOSFODNN7EXAMPLE", "hunter22"):
            self.assertNotIn(secret, report)


if __name__ == "__main__":
    unittest.main()
