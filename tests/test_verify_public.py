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

    def test_low_findings(self):
        terms = json.loads((RT / "context" / "terms.json").read_text(encoding="utf-8"))
        g = vp.Gate(terms, None, {})
        home_drive = "D:" + "\\work\\acme\\x"
        for t in ["deploy: hub at box.tail1a2b.ts.net", "docs: see wiki.acmecorp.internal/page", "nas.local up",
                  "router.lan", "printer.home.arpa", "docs: see docs.example.com/guide",
                  "chore: rotate sk_live_51HxAbCdEfGhIjKlMnOp", "test: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc",
                  "ci: npm_" + "a1B2c3D4" * 4, "ci: hf_" + "a1B2c3D4" * 4, "ci: gho_" + "a1B2c3D4" * 4,
                  "ci: xoxp-1234567890-abc", f"fix {home_drive}"]:
            with self.subTest(t):
                self.assertTrue(g.title_problems(t))                                    # L1
        for v, ok in (("2.1.326", True), ("1.0.0-rc.1", True), ("2.0.1+build.secrethost", False),
                      ("1.2.3-internal", False)):
            with self.subTest(v):
                self.assertEqual(g.type_ok(v, "semver", "runtimes[].version"), ok)    # L3
        svg = {'<svg><g d="203.0.113.9"></g></svg>': True, '<svg viewBox="203.0.113.9"></svg>': True,
               '<svg><path d="M1.5.5.25 12.2.3.4"/></svg>': False, '<polygon points="1.2.3.4 5.6.7.8"/>': False,
               '<polygon d="203.0.113.9"/>': True}
        for html_, blocked in svg.items():
            with self.subTest(html_):                                                    # L4
                self.assertEqual(any("ipv4" in b for b in g.check_text(html_, "x", True)), blocked)
        for v in (float("nan"), float("inf")):
            self.assertFalse(g.type_ok(v, "number", "today.costUsd"))                   # L6
        with self.assertRaises(ValueError):
            vp.strict_json('{"a": NaN}')
        for v in ({"masked": 1}, {"masked": 1.0}, {"masked": "true"}, {"masked": True, "x": 1}):
            self.assertFalse(vp.is_mask(v), v)                                           # L8
        self.assertTrue(vp.is_mask({"masked": True}))

    def test_unexpected_errors_exit_2_without_traceback(self):
        orig = vp.Gate.check_file
        vp.Gate.check_file = lambda self, p: 1 / 0
        try:
            rc, out = run(RT / "samples" / "pass-minimal.json", *self.common, "--private", RT / "context" / "private.json")
        finally:
            vp.Gate.check_file = orig
        self.assertEqual(rc, 2)
        self.assertIn("gate error (ZeroDivisionError)", out)
        self.assertNotIn("Traceback", out)

    def _gate_with_branch(self, branch, terms_extra=(), web=None, priv_edit=None):
        """Gate over the red-team context plus one private commit on `branch`; `web`: a fixture web/ directory."""
        terms = json.loads((RT / "context" / "terms.json").read_text(encoding="utf-8"))
        priv = json.loads((RT / "context" / "private.json").read_text(encoding="utf-8"))
        priv["activity"].append({"t": "2026-11-17T09:50:00+09:00", "source": "local", "repo": "orchid-batch",
                                 "public": False, "title": "fix: y", "branch": branch, "hash": "abc1234", "machine": "A"})
        if priv_edit:
            priv_edit(priv)
        orig = vp.WEB_DIR
        if web is not None:
            vp.WEB_DIR = Path(web)
        try:
            return vp.Gate(dict(terms, terms=terms["terms"] + list(terms_extra)), priv, vp.load_toml(RT / "context" / "public.toml"))
        finally:
            vp.WEB_DIR = orig

    def _page_problems(self, g, edit):
        """check_file on pass-page.html after `edit(text)`; only the private-name problems."""
        page = edit((RT / "samples" / "pass-page.html").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "index.html"
            f.write_text(page, encoding="utf-8")
            return [b for b in g.check_file(f) if "private name" in b]

    def test_branch_fragments_are_exempt_only_inside_verbatim_web_code(self):
        """S15 / R08: a private branch part such as "zorBlax" (feat/reduced-motion-zorBlax) is a weak word.
        It may appear only inside a <script> / <style> body that is byte-for-byte a web/ file as the bundler inlines it
        (the public repository's own code, comments and licence headers included). Anywhere else (markup, attributes,
        comments, <title>, <noscript>, another script, the data) it is refused; a script or style body that is not a
        verbatim web/ file counts as markup (fail closed). A9: "reduced" and "motion" are words of that web/ code, so they
        are no private names at all; "zorBlax" is not (the code's words are "zor" and "blax"), so it stays weak."""
        with tempfile.TemporaryDirectory() as w:
            art = "/* THIRD-PARTY licence header; built from feat/zorBlax */\nconst motion = 'prefers-reduced-motion';\n"
            css = "@media (prefers-reduced-motion: reduce){.x{animation:none}}\n"
            (Path(w) / "art.js").write_text(art, encoding="utf-8")
            (Path(w) / "styles.css").write_text(css, encoding="utf-8")
            (Path(w) / "index.html").write_text('<link rel="stylesheet" href="styles.css"><script src="art.js"></script>',
                                                encoding="utf-8")
            g = self._gate_with_branch("feat/reduced-motion-zorBlax", web=w)
            self.assertIn("zorBlax", g.names)
            self.assertFalse({"reduced", "motion"} & set(g.names))
            ok = lambda x: x
            self.assertEqual(self._page_problems(g, ok), [])
            self.assertEqual(self._page_problems(g, lambda x: x.replace("</head>", f"<style>\n{css}</style></head>", 1)
                                                 .replace("</body>", f"<script>\n{art}</script></body>", 1)), [])
            self.assertEqual(self._page_problems(g, lambda x: x.replace("<main>", "<main><p>reduced motion</p>", 1)), [])
            rows = {
                "html comment": lambda x: x.replace("<main>", "<main><!-- built from feat/zorBlax -->", 1),
                "text node": lambda x: x.replace("<main>", "<main><p>zorBlax</p>", 1),
                "attribute": lambda x: x.replace("<main>", '<main><p title="zorBlax">a</p>', 1),
                "title": lambda x: x.replace("<title>glassbox</title>", "<title>glassbox zorBlax</title>", 1),
                "noscript": lambda x: x.replace("<main>", "<main><noscript>zorBlax</noscript>", 1),
                "other script": lambda x: x.replace("</body>", '<script>const b="zorBlax"</script></body>', 1),
                "window.X": lambda x: x.replace("</body>", '<script>window.X={"t":"zorBlax"}</script></body>', 1),
                "web file changed": lambda x: x.replace("</body>", f"<script>\n{art}const z = 1;\n</script></body>", 1),
                "style not a web file": lambda x: x.replace("</head>", "<style>/* zorBlax */</style></head>", 1),
                "data: public title": lambda x: x.replace("handle empty mapping rule", "handle empty zorBlax rule", 1),
                "data: escaped": lambda x: x.replace("handle empty mapping rule", "handle empty zor\\u0042lax rule", 1),
            }
            for name, edit in rows.items():
                with self.subTest(name):
                    self.assertTrue(self._page_problems(g, edit), name)
        # the same word as an explicit private term is never weak: it counts inside web/ code too
        g2 = self._gate_with_branch("feat/reduced-motion-zorblax", ["motion"])
        self.assertTrue(g2.name_hits("prefers-reduced-motion", weak=False))
        # a private commit's URL host is never weak (security review L1)
        def host(priv):
            priv["activity"].append({"t": "2026-11-17T09:50:00+09:00", "source": "local", "repo": "orchid-batch", "public": False,
                                     "title": "fix: z", "branch": "main", "hash": "abc1234", "url": "http://motion/o/r/commit/abc1234", "machine": "A"})
        self.assertTrue(self._gate_with_branch("main", priv_edit=host).name_hits("prefers-reduced-motion", weak=False))

    def test_web_code_counts_only_when_referenced_and_never_through_a_link(self):
        """Only files web/index.html references are web/ code; a symbolic link among them is a setup error (fail closed)."""
        with tempfile.TemporaryDirectory() as w:
            web = Path(w)
            (web / "a.js").write_text("const a = 1;", encoding="utf-8")
            (web / "stray.js").write_text("const zorblax = 1;", encoding="utf-8")
            (web / "index.html").write_text('<script src="a.js"></script>', encoding="utf-8")
            self.assertEqual(vp.web_bodies(web), {"\nconst a = 1;"})
            (web / "secret.json").write_text('{"secret": "zorblax"}', encoding="utf-8")
            (web / "a.js").unlink()
            (web / "a.js").symlink_to(web / "secret.json")
            with self.assertRaises(vp.SetupError):
                vp.web_bodies(web)

    def test_fragment_inside_a_stronger_word_is_never_weak(self):
        """R08 review M1: "falcon" from feat/falcon-x is a component of the private term falcon-ledger, so it stays strong
        and counts inside web/ code too; an unrelated fragment is weak."""
        g = self._gate_with_branch("feat/falcon-x-motion")
        self.assertTrue(g.name_hits("a falcon flies", weak=False))
        self.assertEqual(g.name_hits("prefers-reduced-motion", weak=False), set())

    def test_commit_ids_in_branch_names_stay_strong(self):
        """R08 security review L1: a branch part that is also a private commit id (fix/deadbee1-x) is never weak."""
        def commit(priv):
            priv["activity"].append({"t": "2026-11-17T09:50:00+09:00", "source": "local", "repo": "orchid-batch",
                                     "public": False, "title": "fix: q", "branch": "main", "hash": "deadbee1", "machine": "A"})
        g = self._gate_with_branch("fix/deadbee1-x", priv_edit=commit)
        self.assertTrue(g.name_hits("ref deadbee1", weak=False))

    def test_vocabulary_parts_only_classify_branch_fragments(self):
        """R08 security review M2: a branch claude/x gives the fragment "claude", a part of the page vocabulary
        (agent claude-code): data with claude-code still publishes. A private repo named exactly "Claude" stays private."""
        g = self._gate_with_branch("claude/zorblax-fix")
        self.assertEqual(g.name_hits('"agent": "claude-code"'), set())
        self.assertEqual(self._page_problems(g, lambda x: x), [])
        def repo(priv):
            priv["activity"].append({"t": "2026-11-17T09:50:00+09:00", "source": "local", "repo": "Claude",
                                     "public": False, "title": "fix: c", "branch": "main", "hash": "c0ffee1", "machine": "A"})
        self.assertIn("Claude", self._gate_with_branch("main", priv_edit=repo).names)

    def test_shipped_page_code_holds_no_fixture_private_word(self):
        """R08 review M1: a coincidence such as "q.x" (normalised "qx", a substring-mode red-team term) in web/ would
        make every bundle fail the gate at publish time; catch it here instead. Every strong private word of the red-team
        terms and of the private example pages, matched the gate's way, against every shipped web/ source (weak words,
        branch fragments, are only searched in the page data)."""
        terms = json.loads((RT / "context" / "terms.json").read_text(encoding="utf-8"))
        cfg = vp.load_toml(RT / "context" / "public.toml")
        for name, priv in (("redteam", RT / "context" / "private.json"), ("example", ROOT / "schema" / "examples" / "page.private.json")):
            g = vp.Gate(terms, json.loads(priv.read_text(encoding="utf-8")), cfg)
            for p in sorted((ROOT / "web").rglob("*")):
                if p.is_file() and p.suffix in (".js", ".css", ".html"):
                    hits = g.name_hits(p.read_text(encoding="utf-8"), weak=False)   # how the gate reads web/ code
                    self.assertEqual(hits, set(), f"{name}: {p.name} holds private word(s) #{sorted(hits)}")

    def test_review2_generated_at_and_conflicts_in_results(self):
        terms = json.loads((RT / "context" / "terms.json").read_text(encoding="utf-8"))
        priv = json.loads((RT / "context" / "private.json").read_text(encoding="utf-8"))
        cfg = vp.load_toml(RT / "context" / "public.toml")
        sample = RT / "samples" / "pass-minimal.json"
        self.assertEqual(vp.Gate(terms, priv, cfg).check_file(sample), [])
        other = dict(priv, generatedAt="2026-11-18T10:30:00+09:00")          # a different run
        self.assertTrue(any("generatedAt" in b for b in vp.Gate(terms, other, cfg).check_file(sample)))
        missing = {k: v for k, v in priv.items() if k != "generatedAt"}
        self.assertTrue(vp.Gate(terms, missing, cfg).check_file(sample))
        cfg2 = dict(cfg, allow=dict(cfg.get("allow", {}), **{"activity[].repo": ["orchid-batch"]}))
        out = vp.Gate(terms, priv, cfg2).check_file(sample)                   # returned, not only printed
        self.assertTrue(any("both public and private" in b for b in out))

    def test_private_page_is_rejected(self):
        rc, out = run(ROOT / "schema" / "examples" / "page.private.json", *self.common,
                      "--private", RT / "context" / "private.json")
        self.assertEqual(rc, 1)
        self.assertIn("view must be 'public'", out)
        self.assertIn("private name #", out)                           # names are numbered, never spelled
        self.assertNotRegex(out, r"[A-Za-z]\*{3,}")                   # L7: no first letters or lengths

    def test_default_config_requires_prefix_only_private_titles(self):
        with tempfile.TemporaryDirectory() as d:
            cfg = Path(d) / "public.toml"                     # no privateTitles: the default applies
            cfg.write_text('githubOwners = ["example-owner"]\nhidden = ["tailnet"]\nbranchFragments = ["example-owner"]\n'
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

    def test_branch_fragments_exempt_only_when_listed(self):
        """R10 (D4): the context has a private branch "example-owner/marmotte". Without branchFragments the
        parts example / owner are private names and the public commit link that spells them is refused;
        listed, they pass. Listing never exempts a private repo name, and other parts stay private."""
        terms, ctx = RT / "context" / "terms.json", RT / "context" / "private.json"
        base = (RT / "context" / "public.toml").read_text(encoding="utf-8")
        self.assertIn('branchFragments = ["example-owner"]\n', base)
        with tempfile.TemporaryDirectory() as d:
            cfg = Path(d) / "public.toml"
            page = json.loads((RT / "samples" / "pass-minimal.json").read_text(encoding="utf-8"))
            p = Path(d) / "page.json"
            p.write_text(json.dumps(page), encoding="utf-8")
            for listed, rc in (("", 1), ('branchFragments = ["example-owner"]\n', 0), ('branchFragments = ["owner", "EXAMPLE"]\n', 0)):
                with self.subTest(listed=listed):
                    cfg.write_text(base.replace('branchFragments = ["example-owner"]\n', listed), encoding="utf-8")
                    code, out = run(p, "--terms", terms, "--config", cfg, "--private", ctx)
                    self.assertEqual(code, rc, out)
                    if rc:
                        self.assertIn("private name", out)
            cfg.write_text(base.replace('branchFragments = ["example-owner"]', 'branchFragments = ["example-owner", "orchid-batch"]'),
                           encoding="utf-8")
            for title in ("docs: marmotte notes", "docs: orchid-batch notes"):
                with self.subTest(title=title):
                    page["activity"][0]["title"] = title
                    p.write_text(json.dumps(page), encoding="utf-8")
                    code, out = run(p, "--terms", terms, "--config", cfg, "--private", ctx)
                    self.assertEqual(code, 1, out)
                    self.assertIn("private name", out)

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
