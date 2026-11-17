"""web/: i18n completeness and the self-contained page rule (scripts/check_web.py)."""
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("check_web", ROOT / "scripts" / "check_web.py")
check_web = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_web)


class WebTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.web = Path(self.tmp.name) / "web"
        shutil.copytree(ROOT / "web", self.web)

    def tearDown(self):
        self.tmp.cleanup()

    def edit(self, name, old, new):
        p = self.web / name
        text = p.read_text(encoding="utf-8")
        self.assertIn(old, text)
        p.write_text(text.replace(old, new, 1), encoding="utf-8")

    def problems(self):
        return "\n".join(check_web.check(self.web))

    def test_repository_web_is_clean(self):
        self.assertEqual(check_web.check(), [])

    def test_three_languages_same_keys(self):
        d = check_web.load_dict()
        self.assertEqual(set(d), {"zh", "ja", "en"})
        self.assertEqual(set(d["zh"]), set(d["en"]))
        self.assertEqual(set(d["ja"]), set(d["en"]))

    def test_template_has_the_data_marker(self):
        from hub import page
        self.assertEqual((ROOT / "web" / "index.html").read_text(encoding="utf-8").count(page.MARKER), 1)

    def test_bundle_is_one_self_contained_document(self):
        from hub import page
        from hub.bundle import bundle
        self.assertIs(bundle, page.bundle)
        for name in ("page.public.json", "page.private.json"):
            data = json.loads((ROOT / "schema" / "examples" / name).read_text(encoding="utf-8"))
            doc = page.bundle(data)
            self.assertEqual(check_web.bundle_problems(doc, data), [], name)
            self.assertEqual(doc.count("window.GB = "), 1)
            for f in ("styles.css", "app.js", "pages.js", "i18n.js"):     # every asset is inlined
                self.assertNotIn(f'"{f}"', doc)

    def test_bundle_escapes_data_and_rejects_bad_templates(self):
        from hub import page
        data = {"title": "</script><script>alert(1)</script>", "x": "a\u2028b"}
        doc = page.bundle(data)
        self.assertNotIn("</script><script>alert", doc)
        self.assertEqual(check_web.bundle_problems(doc, data), [])
        with self.assertRaises(ValueError):
            page.bundle({"x": float("nan")})                                 # strict JSON only
        self.edit("index.html", '<script src="app.js"></script>', '<script src="https:x.js"></script>')
        with self.assertRaises(ValueError):
            page.bundle({}, self.web)
        shutil.copy(ROOT / "web" / "index.html", self.web / "index.html")
        self.edit("app.js", "'use strict';", "'use strict'; const s = '</script>';")
        with self.assertRaises(ValueError):
            page.bundle({}, self.web)
        shutil.copy(ROOT / "web" / "app.js", self.web / "app.js")
        self.edit("index.html", page.CSP + "\n", "")
        with self.assertRaises(ValueError):
            page.bundle({}, self.web)

    def test_bundle_problems_catch_gate_violations(self):
        from hub import page
        doc = page.bundle({})
        self.assertEqual(check_web.bundle_problems(doc, {}), [])
        bad = doc.replace("</body>", "<p>see 9.8.7.6 or token: abcdef, me" + "@example.org, ~/notes</p>"
                          "<link rel=\"stylesheet\" href=\"x.css\"><script>window.GB.x = 1; fetch('//cdn.example')</script></body>")
        out = "\n".join(check_web.bundle_problems(bad, {}))
        for want in ("a.b.c.d", "'token:'", "write to window.GB", "'//'", "e-mail-shaped", "path-shaped", "loads a file"):
            self.assertIn(want, out)

    def test_detects_a_missing_translation(self):
        d = check_web.load_dict(self.web / "i18n.js")
        del d["ja"]["kpi.cost"]
        (self.web / "i18n.js").write_text("window.GLASSBOX_I18N = " + json.dumps(d, ensure_ascii=False) + ";\n", encoding="utf-8")
        self.assertIn("i18n ja: missing key kpi.cost", self.problems())

    def test_detects_placeholder_mismatch(self):
        d = check_web.load_dict(self.web / "i18n.js")
        d["zh"]["stamp"] = "更新于"
        (self.web / "i18n.js").write_text("window.GLASSBOX_I18N = " + json.dumps(d, ensure_ascii=False) + ";\n", encoding="utf-8")
        self.assertIn("placeholders of stamp", self.problems())

    def test_detects_unknown_key_and_hard_coded_text(self):
        self.edit("pages.js", "P.overview = () => {", "P.overview = () => { t('kpi.bogus'); const x = '今天';")
        out = self.problems()
        self.assertIn("'kpi.bogus' is not in the dictionary", out)
        self.assertIn("hard-coded wide text", out)

    def test_detects_bare_text_in_template_and_external_urls(self):
        self.edit("index.html", '<main id="view"', '<p>Hello</p><main id="view"')
        self.edit("styles.css", ":root{", "@import url(x.css);\n:root{")
        self.edit("app.js", "'use strict';", "'use strict'; const cdn = 'https://cdn.example/x.js';")
        out = self.problems()
        self.assertIn("bare text 'Hello'", out)
        self.assertIn("url() / @import", out)
        self.assertIn("app.js", out)
        self.assertIn("'//'", out)


if __name__ == "__main__":
    unittest.main()
