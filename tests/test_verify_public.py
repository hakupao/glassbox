"""Publish gate (S12) command line and setup handling. Fabricated data only."""
import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RT = ROOT / "tests" / "redteam"
_spec = importlib.util.spec_from_file_location("verify_public", ROOT / "scripts" / "verify_public.py")
vp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vp)


def run(*args):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            rc = vp.main([str(a) for a in args])
        except SystemExit as e:          # argparse usage errors
            rc = e.code
    return rc, out.getvalue() + err.getvalue()


class GateCliTest(unittest.TestCase):
    common = ("--terms", RT / "context" / "terms.json", "--config", RT / "context" / "public.toml")

    def test_exit_codes(self):
        ok = RT / "samples" / "pass-minimal.json"
        bad = RT / "samples" / "block-r4-hash.json"
        ctx = RT / "context" / "private.json"
        self.assertEqual(run(ok, *self.common, "--private", ctx)[0], 0)
        rc, out = run(ok, bad, *self.common, "--private", ctx)
        self.assertEqual(rc, 1)
        self.assertIn("private commit keeps hash", out)
        self.assertIn("REJECTED", out)

    def test_setup_errors_fail_closed(self):
        ok = RT / "samples" / "pass-minimal.json"
        with tempfile.TemporaryDirectory() as d:
            missing = Path(d) / "missing.json"
            broken = Path(d) / "broken.json"
            broken.write_text("{", encoding="utf-8")
            no_names = Path(d) / "ctx.json"
            no_names.write_text(json.dumps({"schema": "something"}), encoding="utf-8")
            bad_mode = Path(d) / "terms.json"
            bad_mode.write_text(json.dumps({"terms": ["x"], "match": {"x": "fuzzy"}}), encoding="utf-8")
            ctx = RT / "context" / "private.json"
            cases = {
                "terms missing": (ok, "--terms", missing, "--private", ctx),
                "context missing": (ok, *self.common, "--private", missing),
                "context broken": (ok, *self.common, "--private", broken),
                "context without names": (ok, *self.common, "--private", no_names),
                "no context flag": (ok, *self.common),
                "bad match mode": (ok, "--terms", bad_mode, "--private", ctx),
            }
            for name, args in cases.items():
                with self.subTest(name):
                    self.assertEqual(run(*args)[0], 2)

    def test_allowlisted_private_repo_is_a_conflict(self):
        with tempfile.TemporaryDirectory() as d:
            cfg = Path(d) / "public.toml"
            cfg.write_text((RT / "context" / "public.toml").read_text(encoding="utf-8").replace(
                '[allow]\n', '[allow]\n"activity[].repo" = ["orchid-batch"]\n'), encoding="utf-8")
            rc, out = run(RT / "samples" / "pass-minimal.json", "--terms", RT / "context" / "terms.json",
                          "--config", cfg, "--private", RT / "context" / "private.json")
            self.assertEqual(rc, 1)
            self.assertIn("both public and private", out)

    def test_private_page_is_rejected(self):
        rc, out = run(ROOT / "schema" / "examples" / "page.private.json", *self.common,
                      "--private", RT / "context" / "private.json")
        self.assertEqual(rc, 1)
        self.assertIn("view must be 'public'", out)
        self.assertIn("today.h*****: field not in public_fields.json", out)   # today.hourly, key masked

    def test_default_config_requires_prefix_only_private_titles(self):
        with tempfile.TemporaryDirectory() as d:
            cfg = Path(d) / "public.toml"                     # no privateTitles: the default applies
            cfg.write_text('githubOwners = ["example-owner"]\nhidden = ["tailnet"]\n'
                           '[allow]\n"services[].name" = ["gitea"]\n', encoding="utf-8")
            page = json.loads((RT / "samples" / "pass-minimal.json").read_text(encoding="utf-8"))
            terms, ctx = RT / "context" / "terms.json", RT / "context" / "private.json"
            for title, rc in (("fix: handle empty mapping rule", 1), ("fix:", 0), ("******", 0), ("oops:", 1)):
                with self.subTest(title):
                    page["activity"][1]["title"] = title
                    p = Path(d) / "page.json"
                    p.write_text(json.dumps(page), encoding="utf-8")
                    code, out = run(p, "--terms", terms, "--config", cfg, "--private", ctx)
                    self.assertEqual(code, rc, out)
                    if rc:
                        self.assertIn("must be only a prefix", out)
            cfg.write_text('privateTitles = "full"\n', encoding="utf-8")
            self.assertEqual(run(p, "--terms", terms, "--config", cfg, "--private", ctx)[0], 2)

    def test_assets_get_text_checks(self):
        with tempfile.TemporaryDirectory() as d:
            ok, bad, odd = Path(d) / "app.js", Path(d) / "style.css", Path(d) / "font.woff2"
            ok.write_text("const a = 1; // render masked placeholders\n", encoding="utf-8")
            bad.write_text('@import url("https://fonts.example.net/a.css");\n', encoding="utf-8")
            odd.write_bytes(b"wOF2")
            ctx = RT / "context" / "private.json"
            self.assertEqual(run(ok, *self.common, "--private", ctx)[0], 0)
            rc, out = run(bad, *self.common, "--private", ctx)
            self.assertEqual(rc, 1)
            self.assertIn("external URL", out)
            rc, out = run(odd, *self.common, "--private", ctx)
            self.assertEqual(rc, 1)
            self.assertIn("unknown file type", out)

    def test_unreadable_artifact_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "page.json"
            p.write_bytes(b"\xff\xfe")
            self.assertEqual(run(p, *self.common, "--no-private")[0], 1)


if __name__ == "__main__":
    unittest.main()
