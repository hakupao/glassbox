"""End to end (S11/S12 x lane D): bundle(export(private example)) passes the gate; one tampered
detail in the same bundle makes it fail. Fabricated data only."""
import contextlib
import copy
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

from hub import export as ex
from hub.bundle import CSP as BUNDLE_CSP, bundle

ROOT = Path(__file__).resolve().parent.parent
RT = ROOT / "tests" / "redteam" / "context"
EXAMPLE = json.loads((ROOT / "schema" / "examples" / "page.private.json").read_text(encoding="utf-8"))
_spec = importlib.util.spec_from_file_location("verify_public", ROOT / "scripts" / "verify_public.py")
vp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vp)


class BundleGateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)
        self.cfg_path = self.d / "public.toml"                 # real owner of the example's links
        self.cfg_path.write_text((RT / "public.toml").read_text(encoding="utf-8").replace("example-owner", "hakupao")
                                 + '"jobs[].name" = ["nightly-backup"]\n', encoding="utf-8")
        self.terms = ex.load_terms(RT / "terms.json")
        self.gate = vp.Gate(json.loads((RT / "terms.json").read_text(encoding="utf-8")), EXAMPLE,
                            vp.load_toml(self.cfg_path))

    def tearDown(self):
        self.tmp.cleanup()

    def site(self, html, name="site"):
        s = self.d / name
        s.mkdir()
        (s / "index.html").write_text(html, encoding="utf-8")
        return s

    def html(self, page=None):
        pub, _ = ex.export(copy.deepcopy(page or EXAMPLE), ex.load_config(self.cfg_path), self.terms)
        return pub, bundle(pub)

    def test_same_csp_on_both_sides(self):
        self.assertEqual(BUNDLE_CSP, f'<meta http-equiv="Content-Security-Policy" content="{vp.CSP}">')

    def test_bundle_of_export_passes(self):
        pub, html = self.html()
        self.assertTrue(any(a["url"] for a in pub["activity"]))       # public commit links are in it
        self.assertEqual(self.gate.check_file(self.site(html)), [])

    def test_escaped_data_round_trips(self):
        page = copy.deepcopy(EXAMPLE)
        page["activity"][0]["title"] = "docs: close </script> and   line   separators"
        pub, html = self.html(page)
        self.assertNotIn("</script> and", html)
        self.assertEqual(self.gate.check_file(self.site(html)), [])
        _, page_back = self.gate.check_html_structure(html, "x")
        self.assertEqual(page_back["activity"][0]["title"], pub["activity"][0]["title"])

    def test_one_tampered_detail_is_rejected(self):
        _, html = self.html()
        csp_tag = BUNDLE_CSP
        tampered = {
            "external img": html.replace("<body>", '<body><img src="https://img.example.net/x.png" alt="">', 1),
            "second link": html.replace(csp_tag, csp_tag + '<link rel="icon" href="data:,">', 1),
            "stylesheet link": html.replace(csp_tag, csp_tag + '<link rel="stylesheet" href="x.css">', 1),
            "weaker CSP": html.replace("default-src 'none'", "default-src *", 1),
            "CSP not first": html.replace(csp_tag, '<meta charset="utf-8">' + csp_tag, 1),
            "script src": html.replace("</body>", '<script src="x.js"></script></body>', 1),
            "GB write": html.replace("</body>", "<script>window.GB.tailnet = [];</script></body>", 1),
            "private name": html.replace("</body>", "<!-- falcon_ledger --></body>", 1),
        }
        for name, text in tampered.items():
            with self.subTest(name):
                self.assertNotEqual(text, html)
                self.assertTrue(self.gate.check_file(self.site(text, name.replace(" ", "-"))))

    def test_cli_writes_the_publish_directory(self):
        src = self.d / "private.json"
        src.write_text(json.dumps(EXAMPLE), encoding="utf-8")
        site = self.d / "out" / "site"
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            rc = ex.main([str(src), "--config", str(self.cfg_path), "--terms", str(RT / "terms.json"),
                          "--out", str(self.d / "out" / "page.public.json"), "--site", str(site)])
            again = ex.main([str(src), "--config", str(self.cfg_path), "--terms", str(RT / "terms.json"),
                             "--out", str(self.d / "out" / "p2.json"), "--site", str(site)])
        self.assertEqual((rc, again), (0, 2))                       # a non-empty site dir is refused
        self.assertEqual(sorted(p.name for p in site.iterdir()), ["index.html"])
        self.assertEqual(self.gate.check_file(site), [])


if __name__ == "__main__":
    unittest.main()
