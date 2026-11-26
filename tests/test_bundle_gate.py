"""End to end (S11/S12 x lane D): bundle(export(private example)) passes the gate; one tampered
detail in the same bundle makes it fail. A9: branch parts that are words of the page code. Fabricated data only."""
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

    def gate_for(self, page):
        return vp.Gate(json.loads((RT / "terms.json").read_text(encoding="utf-8")), page, vp.load_toml(self.cfg_path))

    def private_branches(self, repo, *branches):
        """The example with its private local commit renamed to `repo`, once per branch (local source, no Gitea twin)."""
        page = copy.deepcopy(EXAMPLE)
        base = page["activity"][3]
        self.assertEqual((base["source"], base["public"]), ("local", False))
        base["repo"] = repo
        rows = [dict(base, branch=b, hash=f"c0ffee{i}") for i, b in enumerate(branches)]
        page["activity"][3:4] = rows
        return page

    def test_branch_parts_that_are_page_code_words_publish(self):
        """A9: "route" (data-route in the markup), "format" and "preview" (inlined JS; "format" is also a substring of the
        substring-mode private repo name) are words of the page's own code: not private names, so the bundle publishes.
        "planner" is no such word and stays private."""
        words = ex.page_code_words()
        self.assertTrue({"route", "format", "preview"} <= words)
        self.assertNotIn("planner", words)
        page = self.private_branches("geo-transformatics", "feat/route-planner", "wip/format-preview")
        page["activity"][0]["title"] = "feat: route planner preview"
        pub, ctx = ex.export(copy.deepcopy(page), ex.load_config(self.cfg_path), self.terms)
        self.assertFalse({"route", "format", "preview"} & set(ctx["privateNames"]))
        self.assertIn("planner", ctx["privateNames"])
        self.assertNotIn("planner", pub["activity"][0]["title"])
        _, names = vp.derive(page, set())[:2]
        self.assertFalse({"route", "format", "preview"} & names)
        self.assertEqual(self.gate_for(page).check_file(self.site(bundle(pub))), [])

    def test_branch_part_outside_the_page_code_stays_private(self):
        page = self.private_branches("geo-transformatics", "feat/zebrafinch-tuning")
        page["activity"][0]["title"] = "docs: zebrafinch notes"
        pub, ctx = ex.export(copy.deepcopy(page), ex.load_config(self.cfg_path), self.terms)
        self.assertIn("zebrafinch", ctx["privateNames"])
        self.assertNotIn("zebrafinch", json.dumps(pub))
        html = bundle(pub)
        g = self.gate_for(page)
        self.assertEqual(g.check_file(self.site(html)), [])
        planted = html.replace("</body>", "<p>zebrafinch</p></body>", 1)
        self.assertTrue(any("private name" in x for x in g.check_file(self.site(planted, "planted"))))

    def test_page_code_word_in_a_private_name_stays_private(self):
        """A9 guard: "route" is a component (split on - / _ . space, or a word of a camelCase value) of a private repo,
        a term or a private project, so it stays a private name although the page code has it. A title loses it; the
        bundle is refused while such a branch exists (fail closed, no leak)."""
        terms = json.loads((RT / "terms.json").read_text(encoding="utf-8"))
        cfg_text = self.cfg_path.read_text(encoding="utf-8")
        cases = {"repo": ("route-kestrel", [], cfg_text), "camelCase repo": ("RouteKestrel", [], cfg_text),
                 "term": ("geo-transformatics", ["route-heron"], cfg_text),
                 "private project": ("geo-transformatics", [], cfg_text.replace('privateProjects = ["', 'privateProjects = ["route-marten", "', 1))}
        for name, (repo, extra_terms, text) in cases.items():
            with self.subTest(name):
                self.assertIn("privateProjects", text)
                page = self.private_branches(repo, "feat/route-tweaks")
                page["activity"][0]["title"] = "docs: route notes"
                cfg_path = self.d / f"{name.replace(' ', '-')}.toml"
                cfg_path.write_text(text, encoding="utf-8")
                t = dict(terms, terms=terms["terms"] + extra_terms)
                tp = self.d / f"{name.replace(' ', '-')}.json"
                tp.write_text(json.dumps(t), encoding="utf-8")
                pub, ctx = ex.export(copy.deepcopy(page), ex.load_config(cfg_path), ex.load_terms(tp))
                self.assertIn("route", ctx["privateNames"])
                self.assertNotIn("route", pub["activity"][0]["title"])
                g = vp.Gate(t, page, vp.load_toml(cfg_path))
                self.assertIn("route", g.names)
                self.assertTrue(any("private name" in x for x in g.check_file(self.site(bundle(pub), name.replace(" ", "-")))))

    def test_page_code_word_stays_out_of_a_redacted_private_title(self):
        """A9 review M1: privateTitles = "redacted" keeps a private commit's scrubbed title. A branch part freed only as a
        page-code word still leaves it (the exporter scrubs private titles with the pre-A9 set), and the gate refuses a
        private title that holds one; a public title keeps the word."""
        self.assertIn('privateTitles = "redacted"', self.cfg_path.read_text(encoding="utf-8"))
        page = self.private_branches("geo-transformatics", "feat/route-preview")
        page["activity"][0]["title"] = "feat: route preview"
        page["activity"][3]["title"] = "fix: route preview tweak"
        pub, ctx = ex.export(copy.deepcopy(page), ex.load_config(self.cfg_path), self.terms)
        self.assertFalse({"route", "preview"} & set(ctx["privateNames"]))
        self.assertEqual(pub["activity"][0]["title"], "feat: route preview")
        private = [a for a in pub["activity"] if a["public"] is False and a["title"].startswith("fix")]
        self.assertEqual([a["title"] for a in private], ["fix:"])
        g = self.gate_for(page)
        self.assertEqual(g.check_file(self.site(bundle(pub))), [])
        forged = copy.deepcopy(pub)
        next(a for a in forged["activity"] if a in private)["title"] = "fix: route tweak"
        self.assertTrue(any("private commit title holds a private branch part" in x
                            for x in g.check_file(self.site(bundle(forged), "forged"))))
        forged["activity"][[a["title"] for a in forged["activity"]].index("fix: route tweak")]["title"] = "fix: r\\u006fute"
        self.assertTrue(any("private branch part" in x for x in g.check_file(self.site(bundle(forged), "forged2"))))

    def test_exporter_and_gate_read_the_same_page_code_words(self):
        """The exporter keeps its own copy of the gate's page-code words (no import from scripts/): same set on the
        shipped web/ and on fabricated code with every word-splitting case; replaced tags, unreferenced files and
        encoded data runs do not count; a symbolic link (a referenced file, or index.html alone) is refused on both sides."""
        self.assertEqual(ex.page_code_words(), vp.page_code_words())
        web = self.d / "web"
        web.mkdir()
        (web / "index.html").write_text('<html data-route="x"><link rel="stylesheet" href="s.css">'
                                        '<script src="stemword.js"></script><p>HTTPServer x2y</p></html>', encoding="utf-8")
        (web / "s.css").write_text(".fooBar_baz{content:'日本語abc Ελλάδα café ﬁle'}\n", encoding="utf-8")
        (web / "stemword.js").write_text("const camelCaseWord = 'snake_case-kebab';\n", encoding="utf-8")
        (web / "stray.js").write_text("const strayword = 1;\n", encoding="utf-8")
        blob = "Qm9hcmRXb3JkcXVpZXRseWZsb2F0aW5nb3ZlcnRoZWxha2V6ZWJyYWZpbmNoYmFzZTY0ZGF0YXJ1bnM="
        (web / "stemword.js").write_text(f"const camelCaseWord = 'snake_case-kebab';\nconst D = '{blob}';\n", encoding="utf-8")
        a, b = ex.page_code_words(web), vp.page_code_words(web)
        self.assertEqual(a, b)
        self.assertTrue({"route", "http", "server", "foo", "bar", "baz", "camel", "case", "word", "snake", "kebab",
                         "file"} <= a)
        self.assertFalse({"stemword", "strayword"} & a)
        self.assertFalse({"wxha", "zpbm", "zlcn", "jkc"} & a)          # tokens of the encoded data run only
        self.assertEqual(ex.page_code_words(self.d / "missing"), frozenset())
        (web / "s.css").unlink()
        (web / "s.css").symlink_to(web / "stray.js")
        with self.assertRaises(ex.ExportError):
            ex.page_code_words(web)
        with self.assertRaises(vp.SetupError):
            vp.page_code_words(web)
        lone = self.d / "lone"                    # index.html itself a link, no referenced file: refused before reading
        lone.mkdir()
        (self.d / "elsewhere.html").write_text("<p>zebrafinch</p>", encoding="utf-8")
        (lone / "index.html").symlink_to(self.d / "elsewhere.html")
        with self.assertRaises(ex.ExportError):
            ex.page_code_words(lone)
        with self.assertRaises(vp.SetupError):
            vp.page_code_words(lone)

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
