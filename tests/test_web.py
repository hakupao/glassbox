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

    def test_detects_a_missing_translation(self):
        d = check_web.load_dict(self.web / "i18n.js")
        del d["ja"]["kpi.cost"]
        (self.web / "i18n.js").write_text("window.GB_I18N = " + json.dumps(d, ensure_ascii=False) + ";\n", encoding="utf-8")
        self.assertIn("i18n ja: missing key kpi.cost", self.problems())

    def test_detects_placeholder_mismatch(self):
        d = check_web.load_dict(self.web / "i18n.js")
        d["zh"]["stamp"] = "更新于"
        (self.web / "i18n.js").write_text("window.GB_I18N = " + json.dumps(d, ensure_ascii=False) + ";\n", encoding="utf-8")
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
        self.assertIn("CSS url() / @import", out)
        self.assertIn("app.js", out)
        self.assertIn("external URL", out)


if __name__ == "__main__":
    unittest.main()
