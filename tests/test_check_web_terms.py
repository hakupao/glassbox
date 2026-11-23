"""Local web/ word check (backlog A7): scripts/check_web_terms.py. Fabricated data only (red-team context)."""
import contextlib
import importlib.util
import io
import json
import os
import re
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RT = ROOT / "tests" / "redteam" / "context"
sys.path.insert(0, str(ROOT / "scripts"))
_spec = importlib.util.spec_from_file_location("check_web_terms", ROOT / "scripts" / "check_web_terms.py")
cw = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cw)

INDEX = ('<!doctype html><html lang="en"><head>{csp}<title>t</title>{extra}'
         '<link rel="stylesheet" href="s.css"></head><body><script id="gb-data"></script>'
         '<script src="a.js"></script></body></html>\n')


class CheckWebTermsTest(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.d)
        self.web = self.d / "web"
        self.web.mkdir()
        self.page = self.d / "page.json"
        shutil.copy(RT / "private.json", self.page)

    def write(self, js="const a = 1;\n", css="body{}\n", extra=""):
        (self.web / "index.html").write_text(INDEX.format(csp="<meta>", extra=extra), encoding="utf-8")
        (self.web / "a.js").write_text(js, encoding="utf-8")
        (self.web / "s.css").write_text(css, encoding="utf-8")

    def run_cli(self, *extra, page=True):
        args = ["--web", self.web, "--terms", RT / "terms.json", "--config", RT / "public.toml",
                "--page", self.page if page else self.d / "missing.json", *extra]
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                rc = cw.main([str(a) for a in args])
            except SystemExit as e:
                rc = e.code
        return rc, out.getvalue() + err.getvalue()

    def ordinal(self, word):
        """The gate's ordinal of a fabricated word in the same setup."""
        terms = json.loads((RT / "terms.json").read_text(encoding="utf-8"))
        priv = json.loads(self.page.read_text(encoding="utf-8"))
        g = cw.vp.Gate(terms, priv, cw.vp.load_toml(RT / "public.toml"))
        return g.names.index(word) + 1

    def test_clean(self):
        self.write()
        rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        self.assertIn("clean", out)

    def test_strong_word_across_punctuation_reported_by_ordinal_and_line(self):
        self.write(js="const a = 1;\nconst b = 2;\n// Fal.con_Led-ger art\n")
        rc, out = self.run_cli()
        self.assertEqual(rc, 1, out)
        self.assertIn(f"web/a.js:3 term #{self.ordinal('falcon-ledger')}", out)
        for leak in ("falcon", "ledger", "Fal.con"):
            self.assertNotIn(leak, out.lower())

    def test_word_split_across_lines_and_decoded(self):
        self.write(js="x = 'falc'\n+ 'on-ledger';\n", css=".k::after{content:'\\6e ightjar'}\n")
        rc, out = self.run_cli()
        self.assertEqual(rc, 1, out)
        self.assertIn(f"web/a.js:1-2 term #{self.ordinal('falcon-ledger')}", out)
        self.assertIn(f"web/s.css:1 term #{self.ordinal('nightjar')}", out)
        self.assertNotIn("ightjar", out)

    def test_derived_name_needs_the_private_page(self):
        self.write(js="// Billing.API\n")
        rc, out = self.run_cli()
        self.assertEqual(rc, 1, out)
        self.assertIn("web/a.js:1 term #", out)
        self.assertNotIn("billing", out.lower())

    def test_weak_word_in_web_code_not_reported_but_in_markup_is(self):
        self.write(js="// marmotte\n")                     # private branch part of the context: a weak word
        rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        self.write(extra="<!-- marmotte -->")
        rc, out = self.run_cli()
        self.assertEqual(rc, 1, out)
        self.assertRegex(out, r"web/index\.html:1 term #\d+")
        self.assertNotIn("marmotte", out)

    def test_inlined_file_names_in_template_not_reported(self):
        """The bundle replaces <script src="x.js"> / <link href="x.css">: a weak word that is a file's stem only
        appears in the template, never in the shipped page."""
        def priv_edit(p):
            p["activity"][-1]["branch"] = "example-owner/marmotte-icons"
            return p
        self.page.write_text(json.dumps(priv_edit(json.loads(self.page.read_text(encoding="utf-8")))), encoding="utf-8")
        self.write()
        (self.web / "icons.js").write_text("const i = 1;\n", encoding="utf-8")
        index = self.web / "index.html"
        index.write_text(index.read_text(encoding="utf-8").replace("</body>", '<script src="icons.js"></script></body>'),
                         encoding="utf-8")
        rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        index.write_text(index.read_text(encoding="utf-8").replace("<title>t</title>", "<title>icons</title>"),
                         encoding="utf-8")
        rc, out = self.run_cli()
        self.assertEqual(rc, 1, out)                       # the same word in markup still counts

    def test_tag_joins_in_the_assembled_document(self):
        """The bundler writes <style>\\n...</style> and <script>\\n...</script>: a word made of a tag name and a file's
        first word (start) or last word (end) exists only in the assembled page."""
        terms = json.loads((RT / "terms.json").read_text(encoding="utf-8"))
        terms["terms"] += ["stylequail", "heronscript"]
        tf = self.d / "terms.json"
        tf.write_text(json.dumps(terms), encoding="utf-8")
        self.write(css="quail{}\n", js="const a = 'heron'\n")
        rc, out = self.run_cli("--terms", tf)
        self.assertEqual(rc, 1, out)
        self.assertEqual(len(re.findall(r"^web/index\.html:\? term #\d+$", out, re.M)), 2, out)
        for leak in ("quail", "heron"):
            self.assertNotIn(leak, out)

    def test_identical_files_are_both_checked(self):
        self.write()
        (self.web / "b.js").write_text("const a = 1;\n", encoding="utf-8")       # same body as a.js
        index = self.web / "index.html"
        index.write_text(index.read_text(encoding="utf-8").replace("</body>", '<script src="b.js"></script></body>'),
                         encoding="utf-8")
        rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        self.assertIn("4 file(s)", out)

    def test_try_refresh_falls_back_to_cache_and_age_is_shown(self):
        self.write()
        rc, out = self.run_cli("--try-refresh", "2", "--source", "http://127.0.0.1:9/page.json")
        self.assertEqual(rc, 0, out)
        self.assertIn("refresh failed", out)
        self.assertIn("cached 0 day(s) ago", out)
        old = time.time() - 9 * 86400
        os.utime(self.page, (old, old))
        rc, out = self.run_cli()
        self.assertIn("cached 9 day(s) ago; WARNING", out)

    def test_missing_cache_is_terms_only_with_notice(self):
        self.write(js="// Billing.API\n")                  # a derived name only: not checked without the page
        rc, out = self.run_cli(page=False)
        self.assertEqual(rc, 0, out)
        self.assertEqual(out.count("derived names unchecked"), 1)
        self.write(js="// owl_sync nightjar\n")              # word-list terms still are
        rc, out = self.run_cli(page=False)
        self.assertEqual(rc, 1, out)
        self.assertNotIn("owl", out)

    def test_setup_errors_exit_2(self):
        self.write()
        rc, out = self.run_cli("--terms", self.d / "nope.json")
        self.assertEqual(rc, 2)
        self.assertIn("setup error", out)
        self.page.write_text('{"schema": "glassbox.probe/1"}', encoding="utf-8")
        self.assertEqual(self.run_cli()[0], 2)
        (self.web / "index.html").unlink()
        self.page.write_text((RT / "private.json").read_text(encoding="utf-8"), encoding="utf-8")
        self.assertEqual(self.run_cli()[0], 2)

    def test_refresh_failure_keeps_cache(self):
        self.write()
        before = self.page.read_bytes()
        rc, out = self.run_cli("--refresh", "--source", "http://127.0.0.1:9/page.json")
        self.assertEqual(rc, 2)
        self.assertIn("cannot fetch the private page", out)
        self.assertNotIn("Traceback", out)
        self.assertEqual(self.page.read_bytes(), before)

    def test_refresh_writes_cache_0600(self):
        self.write()
        src = self.d / "src.json"
        shutil.copy(RT / "private.json", src)
        self.page = self.d / "cache" / "page.private.json"
        rc, out = self.run_cli("--refresh", "--source", src.as_uri())
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.page.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.page.read_bytes(), src.read_bytes())


if __name__ == "__main__":
    unittest.main()
