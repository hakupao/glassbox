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
            misspelt = Path(d) / "terms2.json"
            misspelt.write_text(json.dumps({"term": ["x"]}), encoding="utf-8")
            unknown_cfg = Path(d) / "c.toml"
            unknown_cfg.write_text('hiden = ["tailnet"]\n', encoding="utf-8")
            clash_cfg = Path(d) / "c2.toml"
            clash_cfg.write_text('codes = ["owl"]\n', encoding="utf-8")
            terms = RT / "context" / "terms.json"
            cases.update({
                "config missing": (ok, "--terms", terms, "--config", missing, "--private", ctx),
                "terms key misspelt": (ok, "--terms", misspelt, "--no-config", "--private", ctx),
                "config key misspelt": (ok, "--terms", terms, "--config", unknown_cfg, "--private", ctx),
                "code on the word list": (ok, "--terms", terms, "--config", clash_cfg, "--private", ctx),
            })
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

    def test_encoded_and_respelt_names_in_html(self):
        """Review M1: every encoding of a test private word is still found."""
        terms = json.loads((RT / "context" / "terms.json").read_text(encoding="utf-8"))
        g = vp.Gate(terms, None, {})
        for t in ["\\x66alcon-ledger", "\\u{66}alcon-ledger", "%2566alcon-ledger", "&#37;66alcon-ledger",
                  "falcon\u00adledger", "falcon\u2011ledger", "'falcon'+'-ledger'", "falc\\6f n-ledger",
                  "f\u0430lcon-ledger", "ｆａｌｃｏｎ-ｌｅｄｇｅｒ", "Owl_sync", "OwlSync", "\\u9752\\u9e1f\\u8ba1\\u5212"]:
            with self.subTest(t):
                self.assertTrue(any("private name" in b for b in g.check_text(f"<p>{t}</p>", "x", True)), t)
        self.assertEqual([b for b in g.check_text("<p>bowling owls nightjars</p>", "x", True) if "private" in b], [])

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

    def test_publish_directory_is_single_file(self):
        """Review M2c: index.html plus an optional one-line CNAME; any other entry is refused."""
        page = (RT / "samples" / "pass-page.html").read_text(encoding="utf-8")
        ctx = RT / "context" / "private.json"
        with tempfile.TemporaryDirectory() as d:
            site = Path(d) / "site"
            site.mkdir()
            (site / "index.html").write_text(page, encoding="utf-8")
            self.assertEqual(run(site, *self.common, "--private", ctx)[0], 0)
            (site / "CNAME").write_text("dash.example.org\n", encoding="ascii")
            self.assertEqual(run(site, *self.common, "--private", ctx)[0], 0)
            for name, setup in {
                "extra js": lambda: (site / "app.js").write_text("const a = 1;\n", encoding="utf-8"),
                "dotfile": lambda: (site / ".nojekyll").write_text("", encoding="utf-8"),
                "subdir": lambda: (site / "assets").mkdir(),
                "bad CNAME": lambda: (site / "CNAME").write_text("a.example.org\nb.example.org\n", encoding="ascii"),
            }.items():
                with self.subTest(name):
                    setup()
                    rc, out = run(site, *self.common, "--private", ctx)
                    self.assertEqual(rc, 1, out)
                    for extra in ("app.js", ".nojekyll"):
                        (site / extra).unlink(missing_ok=True)
                    if (site / "assets").exists():
                        (site / "assets").rmdir()
                    (site / "CNAME").write_text("dash.example.org\n", encoding="ascii")
            js = Path(d) / "app.js"
            js.write_text("const a = 1;\n", encoding="utf-8")
            self.assertEqual(run(js, *self.common, "--private", ctx)[0], 1)

    def test_unreadable_artifact_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "page.json"
            p.write_bytes(b"\xff\xfe")
            self.assertEqual(run(p, *self.common, "--no-private")[0], 1)


if __name__ == "__main__":
    unittest.main()
