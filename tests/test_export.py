"""Public exporter (S11): whitelist rebuild, masking, scrubbing; its output must pass the gate.
All data is fabricated (schema/examples/ and the red-team context)."""
import contextlib
import copy
import io
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from hub import export as ex

ROOT = Path(__file__).resolve().parent.parent
RT = ROOT / "tests" / "redteam" / "context"
EXAMPLE = json.loads((ROOT / "schema" / "examples" / "page.private.json").read_text(encoding="utf-8"))
_spec = importlib.util.spec_from_file_location("verify_public", ROOT / "scripts" / "verify_public.py")
vp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vp)

# Private names of the example page (fabricated), plus the test word list.
PRIVATE = ["falcon-ledger", "orchid-batch", "studio-dev", "client-laptop", "home-server", "garage-mbp",
           "report-worker", "billing-api", "metrics-hub", "pocket-phone", "gitea.example.org", "77c0d1e", "e1f2a3b"]


def write_cfg(d, text):
    p = Path(d) / "public.toml"
    p.write_text(text, encoding="utf-8")
    return ex.load_config(p)


CFG_TEXT = (RT / "public.toml").read_text(encoding="utf-8") + '"jobs[].name" = ["nightly-backup"]\n'


class ExportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = write_cfg(self.tmp.name, CFG_TEXT.replace("example-owner", "hakupao"))
        self.terms = ex.load_terms(RT / "terms.json")
        self.page = copy.deepcopy(EXAMPLE)

    def tearDown(self):
        self.tmp.cleanup()

    def run_export(self, page=None, cfg=None):
        return ex.export(page or self.page, cfg or self.cfg, self.terms)

    def gate(self, pub, ctx, html=False):
        g = vp.Gate(json.loads((RT / "terms.json").read_text(encoding="utf-8")), ctx,
                    vp.load_toml(Path(self.tmp.name) / "public.toml"))
        name = "page.html" if html else "page.json"
        body = json.dumps(pub, ensure_ascii=False)
        text = f"<!doctype html><html><body><script>window.GB = {body};</script></body></html>" if html else body
        p = Path(self.tmp.name) / name
        p.write_text(text, encoding="utf-8")
        return g.check_file(p)

    # --- end to end ---------------------------------------------------------------------------

    def test_example_export_passes_gate_as_json_and_html(self):
        pub, ctx = self.run_export()
        self.assertEqual(self.gate(pub, ctx), [])
        self.assertEqual(self.gate(pub, ctx, html=True), [])

    def test_no_private_name_in_output(self):
        pub, ctx = self.run_export()
        flat = ex.norm(json.dumps(pub, ensure_ascii=False))
        for n in PRIVATE:
            self.assertNotIn(ex.norm(n), flat, vp.hide(n))
        self.assertTrue(set(PRIVATE) - {"gitea.example.org", "77c0d1e", "e1f2a3b"} <= set(ctx["privateNames"]))
        self.assertIn("77c0d1e", ctx["privateNames"])          # private hashes go to the gate too

    # --- rule 1: whitelist rebuild ------------------------------------------------------------

    def test_unknown_fields_never_copied(self):
        self.page["today"]["secretNote"] = "x"
        self.page["activity"][0]["author"] = "someone"
        self.page["extraBlock"] = [{"a": 1}]
        pub, _ = self.run_export()
        self.assertNotIn("secretNote", pub["today"])
        self.assertNotIn("hourly", pub["today"])
        self.assertNotIn("author", pub["activity"][0])
        self.assertNotIn("extraBlock", pub)
        self.assertEqual(pub["view"], "public")

    def test_input_placeholders_are_rebuilt_exactly(self):
        self.page["services"][0]["name"] = {"masked": True, "len": 13}
        pub, ctx = self.run_export()
        self.assertEqual(pub["services"][0]["name"], {"masked": True})
        self.assertEqual(self.gate(pub, ctx), [])

    # --- rule 2: Text ---------------------------------------------------------------------------

    def test_text_masked_unless_allowlisted(self):
        pub, _ = self.run_export()
        names = {s["name"] if isinstance(s["name"], str) else "<m>" for s in pub["services"]}
        self.assertEqual(names, {"gitea", "status-page", "<m>"})
        self.assertTrue(all(m["label"] == {"masked": True} for m in pub["machines"]))
        self.assertEqual(pub["jobs"][0]["name"], "nightly-backup")
        self.assertEqual(pub["tailnet"], [])                    # hidden in the fixture config

    def test_missing_config_masks_everything(self):
        cfg = ex.load_config(Path(self.tmp.name) / "absent.toml")
        pub, ctx = self.run_export(cfg=cfg)
        self.assertTrue(all(s["name"] == {"masked": True} for s in pub["services"]))
        self.assertEqual(pub["hidden"], [])
        self.assertIsNone(next(a for a in pub["activity"] if a["public"])["url"])   # no configured owner => no links
        self.assertEqual(cfg["privateTitles"], "redacted")

    # --- rule 4: private commits ----------------------------------------------------------------

    def test_private_commits_lose_identifiers(self):
        pub, _ = self.run_export()
        priv = [a for a in pub["activity"] if not a["public"]]
        self.assertEqual(len(priv), 2)
        for a in priv:
            self.assertEqual((a["branch"], a["hash"], a["url"], a["machine"]), (None, None, None, None))
            self.assertEqual(a["repo"], {"masked": True})
            self.assertRegex(a["t"], r"T\d\d:00:00")
        self.assertEqual(priv[0]["t"], "2026-11-17T09:00:00+09:00")

    def test_gitea_and_blacklisted_projects_are_private(self):
        self.page["activity"][4]["public"] = True                     # a gitea commit flagged public
        cfg = write_cfg(self.tmp.name, CFG_TEXT.replace('"dotfiles-sandbox"', '"shuttle-path"'))
        pub, ctx = self.run_export(cfg=cfg)
        self.assertFalse(pub["activity"][4]["public"])
        shuttle = [a for a in pub["activity"] if a["t"].startswith("2026-11-16T21")][0]
        self.assertEqual((shuttle["repo"], shuttle["public"], shuttle["hash"]), ({"masked": True}, False, None))
        self.assertNotIn("shuttle-path", ctx["publicRepos"])
        self.assertNotIn("shuttle-path", [p["project"] for p in pub["today"]["byProject"]])
        self.assertEqual(self.gate(pub, ctx), [])

    # --- rule 5: titles -------------------------------------------------------------------------

    def test_titles_scrubbed_public_and_private(self):
        home = "/" + "Users/someone/notes.md"
        bad = ["feat: sync with FalconLedger", "fix: port falcon_ledger and Orchid.Batch",
               "fix: reply to ops@example.com", "chore: point at 203.0.113.7:8080", f"fix: read {home}",
               "fix: read /srv/data/app.db", "chore: rotate AKIAIOSFODNN7EXAMPLE", "test: password=hunter22",
               "fix: ABC-123 crash", "docs: see https://intranet.example.com/wiki", "docs: Project_Nightjar notes",
               "fix: owl config", "test: fooqxbar", "chore: report-worker restart", "ci: listen on fd7a:115c:a1e0::1",
               "chore: deploy to 203.0.113.7.", "fix: edit ~/notes.md", "docs: move docs/" + "home/index.md",
               "feat: support s3:// and file:// schemes", "fix: open C:\\Users\\x\\a.txt"]
        for i, t in enumerate(bad):
            a = copy.deepcopy(self.page["activity"][i % 2 * 3])        # alternate a public and a private commit
            a["title"] = t
            self.page["activity"].append(a)
        pub, ctx = self.run_export()
        titles = [a["title"] for a in pub["activity"][-len(bad):]]
        self.assertTrue(all("******" in t for t in titles), titles)
        self.assertEqual(self.gate(pub, ctx), [])
        self.assertEqual(titles[0], "feat: sync with ******")
        for t in bad:                                   # the gate rejects every original title
            self.assertTrue(vp.Gate(json.loads((RT / "terms.json").read_text(encoding="utf-8")), ctx,
                                    vp.load_toml(Path(self.tmp.name) / "public.toml")).title_problems(t), t)
        for ok in ("fix: v1.2.3 bump at 10:30", "refactor: split a/b/c w/ tests and/or docs"):
            self.assertEqual(ex.scrub_title(ok, [], {}), ok)
        self.assertEqual(ex.scrub_title("docs: nightjars and owls", ["nightjar", "owl"], {"nightjar": "word"}),
                         "docs: nightjars and owls")

    def test_prefix_only(self):
        cfg = write_cfg(self.tmp.name, CFG_TEXT.replace('"redacted"', '"prefix-only"'))
        self.page["activity"][3]["title"] = "feat(orchid-batch)!: new mapper"
        self.page["activity"][4]["title"] = "orchidbatch: hmm"
        pub, ctx = self.run_export(cfg=cfg)
        self.assertEqual(pub["activity"][3]["title"], "feat:")
        self.assertEqual(pub["activity"][4]["title"], "******")
        self.assertEqual(pub["activity"][0]["title"], "feat: 第 12 章模拟题解析")   # public titles keep their text
        self.assertEqual(self.gate(pub, ctx), [])

    def test_public_branch_with_private_name_is_masked(self):
        self.page["activity"][0]["branch"] = "feature/falcon_ledger"
        pub, ctx = self.run_export()
        self.assertEqual(pub["activity"][0]["branch"], {"masked": True})
        self.assertNotIn("feature/falcon_ledger", ctx["publicBranches"])
        self.assertEqual(self.gate(pub, ctx), [])

    # --- usage, quota, hidden ----------------------------------------------------------------

    def test_by_project_merges_private(self):
        self.page["today"]["byProject"].append({"project": "other", "public": False, "requests": 6, "costUsd": 0.3})
        pub, ctx = self.run_export()
        rows = pub["today"]["byProject"]
        self.assertEqual([r["project"] for r in rows[:-1]], ["sdtm-pedia", "shuttle-path"])
        self.assertEqual(rows[-1], {"project": {"masked": True, "group": "private"}, "public": False,
                                    "requests": 520 + 214 + 6, "costUsd": 28.7})
        self.assertNotIn("other", ctx["privateNames"])                 # vocabulary: would block every page
        self.assertEqual(self.gate(pub, ctx), [])

    def test_quota_models_hidden(self):
        self.page["quota"].append({"account": "a_1f2e3d4c", "agent": "codex", "window": "7d", "usedPct": 3,
                                   "resetsAt": "2026-11-20T00:00:00+09:00", "sampledAt": "2026-11-17T10:00:00+09:00",
                                   "history": []})
        self.page["today"]["byModel"].append({"model": "internal-x", "agent": "codex", "requests": 1, "costUsd": None})
        cfg = write_cfg(self.tmp.name, CFG_TEXT.replace('hidden = ["tailnet"]', 'hidden = ["tailnet", "byProject", "jobs"]'))
        pub, ctx = self.run_export(cfg=cfg)
        self.assertEqual([q["account"] for q in pub["quota"]], ["K", "L", "L"])
        self.assertEqual(pub["today"]["byModel"][-1]["model"], "other")
        self.assertEqual((pub["today"]["byProject"], pub["jobs"], pub["tailnet"]), ([], [], []))
        self.assertEqual(pub["hidden"], ["byProject", "jobs", "tailnet"])
        self.assertEqual(self.gate(pub, ctx), [])

    # --- refusing --------------------------------------------------------------------------------

    def test_mistyped_values_raise(self):
        self.page["runtimes"][0]["version"] = "latest"
        with self.assertRaises(ex.ExportError):
            self.run_export()
        page = copy.deepcopy(EXAMPLE)
        page["schema"] = "something/else"
        with self.assertRaises(ex.ExportError):
            self.run_export(page=page)

    def test_bad_config_raises(self):
        for text in ('privateTitles = "none"\n', 'hidden = ["everything"]\n', '[allow]\n"today.requests" = ["1"]\n'):
            with self.subTest(text), self.assertRaises(ex.ExportError):
                write_cfg(self.tmp.name, text)

    def test_cli_writes_page_and_context(self):
        src = Path(self.tmp.name) / "private.json"
        src.write_text(json.dumps(EXAMPLE), encoding="utf-8")
        out, ctx = Path(self.tmp.name) / "o" / "p.json", Path(self.tmp.name) / "c" / "ctx.json"
        quiet = contextlib.ExitStack()
        quiet.enter_context(contextlib.redirect_stdout(io.StringIO()))
        quiet.enter_context(contextlib.redirect_stderr(io.StringIO()))
        with quiet:
            rc = ex.main([str(src), "--config", str(Path(self.tmp.name) / "public.toml"),
                          "--terms", str(RT / "terms.json"), "--out", str(out), "--context", str(ctx)])
            rc_missing = ex.main([str(src), "--terms", str(Path(self.tmp.name) / "missing.json"),
                                  "--out", str(out), "--context", str(ctx)])
        self.assertEqual((rc, rc_missing), (0, 2))
        self.assertEqual(json.loads(out.read_text(encoding="utf-8"))["view"], "public")
        self.assertIn("privateNames", json.loads(ctx.read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()
