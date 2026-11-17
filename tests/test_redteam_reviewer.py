"""Security review 1: the reviewer's repro samples, verbatim (tests/redteam/reviewer/cases.json).

Each case only has to be REFUSED — the export raises, or leaks none of the probe strings, or the
gate rejects. Which message is produced is deliberately not asserted. HTML samples are wrapped in
the required CSP head, and the bare wrapper must pass, so a rejection is caused by the attack and
not by the wrapper. Fabricated data only.
"""
import copy
import importlib.util
import json
import math
import tempfile
import unittest
from pathlib import Path

from hub import export as ex

ROOT = Path(__file__).resolve().parent.parent
RT = ROOT / "tests" / "redteam"
_spec = importlib.util.spec_from_file_location("verify_public", ROOT / "scripts" / "verify_public.py")
vp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vp)
EXAMPLE = json.loads((ROOT / "schema" / "examples" / "page.private.json").read_text(encoding="utf-8"))
CASES = json.loads((RT / "reviewer" / "cases.json").read_text(encoding="utf-8"))["cases"]
# Not covered by any review item; a ruling was asked of the lead (2026-11-17). They are NOT
# counted as refused: test_pending_cases_are_still_open fails the day one starts being refused,
# so this list cannot go stale silently.
PENDING = {
    "hourly-name-in-title": "name only in warnings (free text, not a Text field): no rule covers it",
    "html svg-path-ip": "review L4 keeps <path d> geometry exempt from the IPv4 check",
}


def value(v):
    return float(v["$float"]) if isinstance(v, dict) and set(v) == {"$float"} else v


def apply(page, ops):
    for op, path, v in ops:
        node = page
        for k in path[:-1]:
            node = node[k]
        if op == "set":
            node[path[-1]] = value(v)
        else:
            node[path[-1]].append(value(v))


def wrap(body, head="", extra=""):
    return (f'<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="{vp.CSP}">{head}'
            f"</head><body>{extra}<script>window.GB = {body};</script></body></html>")


class ReviewerSamplesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        self.cfg_path = d / "public.toml"
        self.cfg_path.write_text((RT / "context" / "public.toml").read_text(encoding="utf-8")
                                 .replace("example-owner", "hakupao") + '"jobs[].name" = ["nightly-backup"]\n',
                                 encoding="utf-8")
        self.cfg = ex.load_config(self.cfg_path)
        self.terms = ex.load_terms(RT / "context" / "terms.json")
        self.terms_raw = json.loads((RT / "context" / "terms.json").read_text(encoding="utf-8"))

    def tearDown(self):
        self.tmp.cleanup()

    def gate(self, private):
        return vp.Gate(self.terms_raw, private, vp.load_toml(self.cfg_path))

    def refused_export(self, case):
        page = copy.deepcopy(EXAMPLE)
        apply(page, case["ops"])
        try:
            pub, _ = ex.export(page, self.cfg, self.terms)
        except ex.ExportError:
            return True
        text = json.dumps(pub, ensure_ascii=False)
        flat = ex.norm(ex.decode(text))
        leaked = [p for p in case["probes"] if p in text or (len(ex.norm(p)) >= 5 and ex.norm(p) in flat)]
        leaked += [p for p in case["normProbes"] if ex.norm(p) in flat]
        for path in case["mustBeNull"]:
            node = pub
            for k in path:
                node = node[k]
            if node is not None:
                leaked.append("/".join(map(str, path)))
        if leaked:
            return False
        # Values the export may not stop itself (NaN): the gate must reject the output then.
        if any(isinstance(value(v), float) and not math.isfinite(value(v)) for _, _, v in case["ops"]):
            f = Path(self.tmp.name) / "p.json"
            f.write_text(json.dumps(pub), encoding="utf-8")
            return bool(self.gate(page).check_file(f))
        return True

    def refused_gate(self, case):
        pub, _ = ex.export(copy.deepcopy(EXAMPLE), self.cfg, self.terms)
        body = json.dumps(pub, ensure_ascii=False)
        if case.get("dataReplace"):
            old, new = case["dataReplace"]
            body = body.replace(old, new, 1)
        d = Path(self.tmp.name)
        g = self.gate(EXAMPLE)
        if case["kind"] == "json":
            f = d / "page.json"
            f.write_text(body, encoding="utf-8")
            return bool(g.check_file(f))
        if case["kind"] == "dir":
            site = d / "site"
            site.mkdir()
            (site / "index.html").write_text(wrap(body, extra=case["index"]), encoding="utf-8")
            for name, text in case["files"].items():
                (site / name).write_text(text, encoding="utf-8")
            return bool(g.check_file(site))
        f = d / "index.html"
        f.write_text(wrap(body, case["head"], case["body"]), encoding="utf-8")
        return bool(g.check_file(f))

    def test_wrapper_alone_passes(self):
        pub, _ = ex.export(copy.deepcopy(EXAMPLE), self.cfg, self.terms)
        f = Path(self.tmp.name) / "index.html"
        f.write_text(wrap(json.dumps(pub, ensure_ascii=False)), encoding="utf-8")
        self.assertEqual(self.gate(EXAMPLE).check_file(f), [])

    def test_every_reviewer_sample_is_refused(self):
        self.assertGreaterEqual(len(CASES), 50)
        for case in CASES:
            with self.subTest(case["id"]):
                if case["id"] in PENDING:
                    continue
                ok = self.refused_export(case) if case["kind"] == "export" else self.refused_gate(case)
                self.assertTrue(ok, f"not refused: {case['source']} {case['id']}")


    def test_exports_that_do_not_raise_pass_the_gate(self):
        """Round trip: whatever the exporter emits for a reviewer input, the gate accepts."""
        for case in CASES:
            if case["kind"] != "export" or any(isinstance(value(v), float) for _, _, v in case["ops"]):
                continue
            with self.subTest(case["id"]):
                page = copy.deepcopy(EXAMPLE)
                apply(page, case["ops"])
                try:
                    pub, _ = ex.export(page, self.cfg, self.terms)
                except ex.ExportError:
                    continue
                f = Path(self.tmp.name) / "rt.json"
                f.write_text(json.dumps(pub, ensure_ascii=False), encoding="utf-8")
                self.assertEqual(self.gate(page).check_file(f), [])

    def test_pending_cases_are_still_open(self):
        for case in CASES:
            if case["id"] in PENDING:
                with self.subTest(case["id"]):
                    ok = self.refused_export(case) if case["kind"] == "export" else self.refused_gate(case)
                    self.assertFalse(ok, "now refused: drop it from PENDING")


if __name__ == "__main__":
    unittest.main()
