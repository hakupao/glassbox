"""Public exporter (S11): whitelist rebuild, masking, scrubbing; its output must pass the gate.
All data is fabricated (schema/examples/ and the red-team context)."""
import collections
import contextlib
import copy
import io
import importlib.util
import json
import re
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
UNLISTED = CFG_TEXT.replace('branchFragments = ["example-owner"]\n', "")         # R10: no branch part listed
assert UNLISTED != CFG_TEXT


class ExportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = write_cfg(self.tmp.name, CFG_TEXT.replace("example-owner", "hakupao"))
        self.terms = ex.load_terms(RT / "terms.json")
        self.page = copy.deepcopy(EXAMPLE)

    def tearDown(self):
        self.tmp.cleanup()

    def run_export(self, page=None, cfg=None):
        self.last_input = page or self.page          # the gate derives visibility from the private page
        return ex.export(self.last_input, cfg or self.cfg, self.terms)

    def gate(self, pub, ctx=None, html=False):
        g = vp.Gate(json.loads((RT / "terms.json").read_text(encoding="utf-8")), self.last_input,
                    vp.load_toml(Path(self.tmp.name) / "public.toml"))
        name = "page.html" if html else "page.json"
        body = json.dumps(pub, ensure_ascii=False)
        text = (f'<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="{vp.CSP}"></head>'
                f"<body><script>window.GB = {body};</script></body></html>") if html else body
        p = Path(self.tmp.name) / name
        p.write_text(text, encoding="utf-8")
        return g.check_file(p)

    # --- end to end ---------------------------------------------------------------------------

    def test_machine_icon_and_color_are_exported(self):
        pub, ctx = self.run_export()
        want = {m["id"]: (m["icon"], m["color"]) for m in EXAMPLE["machines"]}
        self.assertEqual({m["id"]: (m["icon"], m["color"]) for m in pub["machines"]}, want)
        self.assertEqual(self.gate(pub, ctx), [])
        page = copy.deepcopy(EXAMPLE)
        page["machines"][0]["icon"] = None
        pub, ctx = self.run_export(page)
        self.assertIsNone(pub["machines"][0]["icon"])
        self.assertEqual(self.gate(pub, ctx), [])
        page["machines"][0]["icon"] = "rocket"                          # off the list: the export fails closed
        with self.assertRaises(ex.ExportError):
            self.run_export(page)
        page["machines"][0]["icon"], page["machines"][0]["color"] = "laptop", "#ff0000"
        with self.assertRaises(ex.ExportError):
            self.run_export(page)

    def test_machine_today_by_agent_stays_private(self):
        page = copy.deepcopy(EXAMPLE)
        for m in page["machines"]:
            m["todayByAgent"] = [{"agent": "claude-code", "requests": 7, "unpricedRequests": 0, "costUsd": 1.5, "sessions": 2}]
        pub, _ = self.run_export(page)
        self.assertTrue(pub["machines"])
        self.assertTrue(all("todayByAgent" not in m for m in pub["machines"]))
        self.assertNotIn("todayByAgent", json.dumps(pub))

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
        self.page["activity"][0]["reviewer"] = "someone"          # (author is a public field since S17 R09)
        self.page["extraBlock"] = [{"a": 1}]
        pub, _ = self.run_export()
        self.assertNotIn("secretNote", pub["today"])
        self.assertNotIn("hourly", pub["today"])
        self.assertNotIn("reviewer", pub["activity"][0])
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

    def test_missing_config_is_an_error_and_no_config_is_strictest(self):
        with self.assertRaises(ex.ExportError):
            ex.load_config(Path(self.tmp.name) / "absent.toml")
        cfg = ex.load_config(None)                                     # --no-config
        pub, ctx = self.run_export(cfg=cfg)
        self.assertTrue(all(s["name"] == {"masked": True} for s in pub["services"]))
        self.assertEqual(pub["hidden"], [])
        self.assertIsNone(next(a for a in pub["activity"] if a["public"])["url"])   # no configured owner => no links
        self.assertEqual(cfg["privateTitles"], "prefix-only")          # owner's decision 2026-11-17
        self.assertTrue(all(a["title"] in ("fix:", "refactor:", "******") for a in pub["activity"] if not a["public"]))
        terms = json.loads((RT / "terms.json").read_text(encoding="utf-8"))
        self.assertEqual(vp.Gate(terms, self.page, {}).check_page(pub, "p"), [])      # gate with the same empty config

    # --- review H1: one private occurrence makes a name private everywhere ------------------

    def test_visibility_conflict_resolves_to_private(self):
        mutations = {
            "byProject says public, activity gitea": lambda p: p["today"]["byProject"][1].update(public=True),
            "other casing private": lambda p: p["activity"].append(dict(p["activity"][3], repo="SDTM-Pedia")),
            "code.repos says gitea": lambda p: p.__setitem__("code", {"repos": [
                {"repo": "shuttle-path", "public": True, "sources": ["github", "gitea"]}], "commits": []}),
            "usageDays private": lambda p: p.__setitem__("usageDays", [{"date": "2026-11-17", "byProject": [
                {"project": "sdtm-pedia", "public": False}]}]),
        }
        hidden = {"byProject says public, activity gitea": "falcon-ledger", "other casing private": "sdtm-pedia",
                  "code.repos says gitea": "shuttle-path", "usageDays private": "sdtm-pedia"}
        for name, mut in mutations.items():
            with self.subTest(name):
                page = copy.deepcopy(EXAMPLE)
                mut(page)
                pub, ctx = self.run_export(page=page)
                self.assertNotIn(ex.norm(hidden[name]), ex.norm(json.dumps(pub, ensure_ascii=False)))
                self.assertNotIn(hidden[name], ctx["publicRepos"])
                self.assertEqual(self.gate(pub), [])

    def test_names_only_in_detail_blocks_are_private(self):
        self.page["code"] = {"repos": [{"repo": "heron-vault", "public": False, "sources": ["local"]}],
                             "commits": [{"repo": "kite-notes", "public": False, "hash": "abcdef1", "title": "x"}]}
        self.page["usageDays"] = [{"date": "2026-11-17", "byProject": [{"project": "wren-tools", "public": False}]}]
        self.page["activity"][0]["title"] = "feat: port HeronVault, kite_notes and Wren.Tools"
        pub, ctx = self.run_export()
        self.assertTrue({"heron-vault", "kite-notes", "wren-tools", "abcdef1"} <= set(ctx["privateNames"]))
        self.assertEqual(pub["activity"][0]["title"], "feat:")
        self.assertEqual(self.gate(pub), [])

    def test_private_branch_parts_are_private(self):
        """Review M3: telling parts of a private branch name may not appear elsewhere."""
        self.page["activity"][3]["branch"] = "feat/kestrel-client"
        self.page["activity"][0]["title"] = "merge kestrel-client work"
        self.page["activity"][5]["title"] = "feat: new feature flag for main dev"
        pub, ctx = self.run_export()
        self.assertTrue({"kestrel", "client"} <= set(ctx["privateNames"]))
        self.assertNotIn("feat", ctx["privateNames"])
        self.assertNotIn("kestrel", json.dumps(pub))
        self.assertEqual(pub["activity"][5]["title"], "feat: new feature flag for main dev")
        self.assertEqual(self.gate(pub), [])
        forged = copy.deepcopy(pub)
        forged["activity"][5]["title"] = "feat: kestrel"
        self.assertTrue(self.gate(forged))

    def rename_repo(self, old, new):
        code = self.page.get("code") or {}
        for e in self.page["activity"] + (code.get("repos") or []) + (code.get("commits") or []):
            if e.get("repo") == old:
                e["repo"] = new

    def test_public_repo_name_as_private_branch_part_is_not_a_conflict(self):
        """A private branch "shuttle/fix" names a public repo "shuttle" (e.g. the owner's profile repo):
        the part reveals nothing, so the gate must not see that repo as both public and private
        (the publisher stopped on this 2026-11-19)."""
        self.rename_repo("shuttle-path", "shuttle")
        self.page["activity"][4]["branch"] = "shuttle/fix-ledger"
        pub, ctx = self.run_export()
        self.assertNotIn("shuttle", ctx["privateNames"])
        self.assertIn("ledger", ctx["privateNames"])  # the branch's other parts stay private
        self.assertIn("shuttle", [a.get("repo") for a in pub["activity"]])
        self.assertEqual(self.gate(pub, ctx), [])

    def test_name_private_in_one_spelling_keeps_its_branch_part(self):
        """Public as "Shuttle" but private as "shuttle" elsewhere: private everywhere, so the branch
        part stays a private name and a forged title carrying it is refused."""
        self.rename_repo("shuttle-path", "Shuttle")
        self.page["activity"][3]["repo"] = "shuttle"           # a private occurrence (local, public:false)
        self.page["activity"][4]["branch"] = "Shuttle/secret-tuning"
        self.page["activity"][0]["title"] = "docs: shuttle notes"
        pub, ctx = self.run_export()
        self.assertTrue({"Shuttle", "shuttle"} & set(ctx["privateNames"]))
        self.assertNotIn("shuttle", json.dumps(pub["activity"][0]).lower())
        forged = copy.deepcopy(pub)
        forged["activity"][0]["title"] = "docs: shuttle notes"
        self.assertTrue(self.gate(forged))

    def test_allowlisted_word_of_another_field_does_not_exempt_a_branch_part(self):
        """Only public repo names exempt a branch part in any case; a service name allowlisted as
        "Grafana" does not, so the exporter scrubs "grafana" from titles like the gate expects."""
        cfg = write_cfg(self.tmp.name, CFG_TEXT.replace("example-owner", "hakupao")
                        .replace('"services[].name" = ["gitea", "status-page"]', '"services[].name" = ["gitea", "status-page", "Grafana"]'))
        self.page["activity"][4]["branch"] = "feat/grafana-tuning"
        self.page["activity"][0]["title"] = "fix: bump grafana"
        pub, ctx = self.run_export(cfg=cfg)
        self.assertNotIn("grafana", json.dumps(pub["activity"]).lower())
        self.assertEqual(self.gate(pub, ctx), [])

    def test_public_repo_name_as_branch_part_any_case(self):
        self.rename_repo("shuttle-path", "shuttle")
        self.page["activity"][4]["branch"] = "Shuttle/fix"
        pub, ctx = self.run_export()
        self.assertNotIn("Shuttle", ctx["privateNames"])
        self.assertEqual(self.gate(pub, ctx), [])

    def test_branch_part_does_not_weaken_a_name(self):
        """A private repo and a private branch part with the same spelling: substring match stays."""
        self.page["activity"][3].update(repo="kestrel", branch="feat/kestrel")
        self.page["activity"][0]["title"] = "docs: mykestrels notes"
        pub, _ = self.run_export()
        self.assertEqual(pub["activity"][0]["title"], "docs:")
        forged = copy.deepcopy(pub)
        forged["activity"][0]["title"] = "docs: mykestrels notes"
        self.assertTrue(self.gate(forged))

    def test_gate_rejects_forged_public_name(self):
        pub, _ = self.run_export()
        pub["today"]["byProject"].insert(0, {"project": "falcon-ledger", "public": True, "requests": 1, "costUsd": 0.1})
        self.assertTrue(self.gate(pub))                  # the gate derives visibility itself

    def test_gate_and_exporter_agree_on_visibility(self):
        """Differential: the gate's public set is within the exporter's, its private names cover the exporter's."""
        pages = [copy.deepcopy(EXAMPLE)]
        p = copy.deepcopy(EXAMPLE)
        p["today"]["byProject"][1]["public"] = True
        pages.append(p)
        p = copy.deepcopy(EXAMPLE)
        p["code"] = {"repos": [{"repo": "sdtm-pedia", "public": True, "sources": ["gitea"]}], "commits": []}
        pages.append(p)
        for page in pages:
            pub, ctx = self.run_export(page=page)
            g_public, g_names, _, _ = vp.derive(page, self.cfg["privateProjects"])
            self.assertLessEqual(set(ctx["publicRepos"]), g_public)
            self.assertLessEqual(g_public, set(ctx["publicRepos"]))
            norm_g = {vp.norm(n) for n in g_names}
            self.assertTrue(all(vp.norm(n) in norm_g for n in ctx["privateNames"]))

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
        self.assertTrue(all("******" in t or re.fullmatch(r"[a-z]+:", t) for t in titles), titles)
        self.assertEqual(self.gate(pub, ctx), [])
        self.assertEqual(titles[0], "feat:")                       # a private name cuts the title (L9)
        for t in bad:                                   # the gate rejects every original title
            self.assertTrue(vp.Gate(json.loads((RT / "terms.json").read_text(encoding="utf-8")), self.page,
                                    vp.load_toml(Path(self.tmp.name) / "public.toml")).title_problems(t), t)
        for ok in ("fix: v1.2.3 bump at 10:30", "refactor: split a/b/c w/ tests and/or docs"):
            self.assertEqual(ex.scrub_title(ok, ex.Matcher([], {})), ok)
        m = ex.Matcher(["nightjar", "owl"], {"nightjar": "word"})
        self.assertEqual(ex.scrub_title("docs: nightjars and owls in bowling", m), "docs: nightjars and owls in bowling")

    def test_name_spellings_and_encodings_are_caught(self):
        """Review M1 / L2 / L9: one test word list, many spellings."""
        m = ex.Matcher(["falcon-ledger", "owl", "青鸟计划"], {})
        for t in ["falcon\u200bledger", "ｆａｌｃｏｎ-ledger", "falcon/ledger", "falcon:ledger", "f\u0430lcon-ledger",
                  "falcon\u00adledger", "falcon\u2011ledger", "FALCON-LEDGER", "Falcon_Ledger", "owl_sync", "OwlSync",
                  "修复owl问题", "OWL2 rollout", "项目青鸟计划完成"]:
            with self.subTest(t):
                self.assertTrue(m.hit(t))
        for t in ["falcon%2Dledger", "falcon&#45;ledger", "falcon%252Dledger"]:
            with self.subTest(t):
                self.assertEqual(ex.scrub_title(f"fix: {t}", m), "fix:")
        for t in ["bowling", "owls", "knowledge", "a falcon and a ledger"]:
            with self.subTest(t):
                self.assertFalse(m.hit(t))

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

    # --- lane A inputs: nullable fields, provisional blocks, local commits ----------------------

    def test_lane_a_nulls_and_provisional_fields(self):
        p = self.page
        p["machines"][0].update(role=None, os=None)
        p["machines"][0]["history"][0]["diskPct"] = 40.0
        p["runtimes"][0]["version"] = None
        p["tailnet"][0]["lastSeen"] = None
        p["services"][0]["machine"] = None
        p["quota"].append(dict(p["quota"][0], account="a_1f2e3d4c"))         # no code configured: hash
        p.update(usageDays=[{"date": "2026-11-17", "byMachine": [{"machine": "A", "requests": 1, "costUsd": 0.1}]}],
                 code={"repos": []}, warnings=["probe B is late"])
        p["contributions"]["githubOfficialTotal"] = 7000
        cfg = ex.load_config(None)                                     # strictest; tailnet not hidden
        pub, ctx = self.run_export(cfg=cfg)
        m = pub["machines"][0]
        self.assertEqual((m["role"], m["os"]), (None, None))
        self.assertNotIn("diskPct", m["history"][0])
        self.assertIsNone(pub["runtimes"][0]["version"])
        self.assertIsNone(pub["tailnet"][0]["lastSeen"])
        self.assertIsNone(pub["services"][0]["machine"])
        self.assertEqual([q["account"] for q in pub["quota"]], ["K", "L", "L"])
        for k in ("usageDays", "code", "warnings"):
            self.assertNotIn(k, pub)
        self.assertNotIn("githubOfficialTotal", pub["contributions"])
        self.assertNotIn("a_1f2e3d4c", json.dumps(pub))
        gate = lambda page: vp.Gate(json.loads((RT / "terms.json").read_text(encoding="utf-8")), self.page, {}).check_page(page, "p")
        self.assertEqual(gate(pub), [])
        for put in (lambda q: q.__setitem__("usageDays", []), lambda q: q.__setitem__("warnings", ["x"]),
                    lambda q: q.__setitem__("code", {}),
                    lambda q: q["contributions"].__setitem__("githubOfficialTotal", 1),
                    lambda q: q["machines"][0]["history"][0].__setitem__("diskPct", 1.0)):
            q = copy.deepcopy(pub)
            put(q)
            self.assertTrue(any("field not in public_fields.json" in b for b in gate(q)))
        q = copy.deepcopy(pub)
        q["quota"][0]["account"] = "a_1f2e3d4c"
        self.assertTrue(any("is not code" in b for b in gate(q)))

    def test_label_equal_to_code_is_not_a_private_name(self):
        for m in self.page["machines"]:
            m["label"] = m["id"]                       # hub default when no label is configured
        pub, ctx = self.run_export()
        self.assertFalse({"A", "B", "C", "D", "V"} & set(ctx["privateNames"]))
        self.assertTrue(all(m["label"] == {"masked": True} for m in pub["machines"]))
        self.assertEqual(self.gate(pub, ctx), [])

    def test_multi_char_code_as_label_does_not_stop_export(self):
        # Backlog A3: real codes are names like "vm-box"; a machine without a label shows its code.
        cfg = write_cfg(self.tmp.name, 'codes = ["vm-box"]\n' + CFG_TEXT.replace("example-owner", "hakupao"))
        m = next(m for m in self.page["machines"] if m["id"] == "V")
        m["id"] = m["label"] = "vm-box"
        pub, ctx = self.run_export(cfg=cfg)
        self.assertNotIn("vm-box", ctx["privateNames"])
        self.assertEqual(self.gate(pub, ctx), [])

    def test_code_still_clashes_with_a_real_private_name(self):
        # Only a label equal to its own machine code is exempt; a code that equals a repo name is not.
        cfg = write_cfg(self.tmp.name, 'codes = ["falcon-ledger"]\n' + CFG_TEXT.replace("example-owner", "hakupao"))
        m = next(m for m in self.page["machines"] if m["id"] == "V")
        m["id"] = m["label"] = "falcon-ledger"         # the exemption path must not swallow the clash
        with self.assertRaises(ex.ExportError):
            self.run_export(cfg=cfg)
        self.last_input = self.page                   # the gate refuses the same config on its own
        with self.assertRaises(vp.SetupError):
            self.gate({})

    def test_label_equal_to_a_non_code_id_stays_private(self):
        # Review of A3: only a PUBLIC code is exempt. A private host name used as id and label, with
        # the machine block hidden, must still be scrubbed from titles and caught by the gate.
        cfg = write_cfg(self.tmp.name, CFG_TEXT.replace("example-owner", "hakupao")
                        .replace('hidden = ["tailnet"]', 'hidden = ["tailnet", "machines", "runtimes", "jobs"]'))
        m = next(m for m in self.page["machines"] if m["id"] == "V")
        m["id"] = m["label"] = "secret-host"
        self.page["activity"][0]["title"] = "fix: deploy to secret-host"
        pub, ctx = self.run_export(cfg=cfg)
        self.assertIn("secret-host", ctx["privateNames"])
        self.assertNotIn("secret-host", json.dumps(pub))
        forged = copy.deepcopy(pub)
        forged["activity"][0]["title"] = "fix: deploy to secret-host"
        self.assertTrue(self.gate(forged))

    def test_code_label_on_another_machine_is_judged_per_machine(self):
        # Machine V shows its own code "vm-box"; machine D is labelled "vm-box" too: that label is
        # not D's code, so both exporter and gate refuse (same verdict on both sides).
        cfg = write_cfg(self.tmp.name, 'codes = ["vm-box"]\n' + CFG_TEXT.replace("example-owner", "hakupao"))
        v = next(m for m in self.page["machines"] if m["id"] == "V")
        v["id"] = v["label"] = "vm-box"
        next(m for m in self.page["machines"] if m["id"] == "D")["label"] = "vm-box"
        with self.assertRaises(ex.ExportError):
            self.run_export(cfg=cfg)
        self.last_input = self.page
        with self.assertRaises(vp.SetupError):
            self.gate({})

    def test_code_clash_ignores_case_on_both_sides(self):
        cfg = write_cfg(self.tmp.name, 'codes = ["vm-box"]\n' + CFG_TEXT.replace("example-owner", "hakupao"))
        v = next(m for m in self.page["machines"] if m["id"] == "V")
        v["id"], v["label"] = "vm-box", "VM-Box"
        with self.assertRaises(ex.ExportError):
            self.run_export(cfg=cfg)
        self.last_input = self.page
        with self.assertRaises(vp.SetupError):
            self.gate({})

    def test_local_commit_of_public_repo_loses_branch_keeps_hash(self):
        pub, ctx = self.run_export()
        a = pub["activity"][1]                                    # source local, public repo, branch "dev"
        self.assertEqual((a["source"], a["public"], a["branch"], a["hash"]), ("local", True, None, "5c1d9e0"))
        self.assertEqual(self.gate(pub, ctx), [])
        a["branch"] = "main"
        self.assertTrue(any("local commit keeps branch" in b for b in self.gate(pub, ctx)))

    # --- S17 R09: author, file count, file paths; R10: listed branch fragments --------------------

    def files_on(self, i, paths, n=None):
        a = self.page["activity"][i]
        a["files"] = [{"s": "M", "p": x} for x in paths]
        a["nFiles"] = len(paths) if n is None else n
        return a

    def test_files_only_on_public_pushed_github_commits(self):
        """files non-empty => public, pushed, source github. Every other commit keeps its count only:
        a local commit of a public repo, an unpushed one, a Gitea one (pushed to a private remote),
        a private one, and a public GitHub repo blacklisted in privateProjects."""
        self.rename_repo("shuttle-path", "dotfiles-sandbox")                      # privateProjects in the config
        for i in range(len(self.page["activity"])):
            self.files_on(i, ["docs/readme.md", "src/main.py"], n=5)
        self.page["activity"][2]["pushed"] = True                                  # GitHub, public
        pub, ctx = self.run_export()
        kept = [(a["source"], a["public"], a["pushed"]) for a in pub["activity"] if a.get("files")]
        self.assertEqual(kept, [("github", True, True), ("github", True, True)])
        self.assertTrue(all(a["nFiles"] == 5 for a in pub["activity"]))           # the count everywhere
        self.assertTrue(all("files" not in a for a in pub["activity"] if not a.get("files")))   # dropped, not null
        self.assertEqual(self.gate(pub, ctx), [])
        self.assertEqual(self.gate(pub, ctx, html=True), [])
        # The gate enforces the same invariant on its own.
        for i, put in ((1, {}), (3, {}), (4, {}), (0, {"pushed": False}), (0, {"source": "local", "branch": None, "url": None})):
            forged = copy.deepcopy(pub)
            forged["activity"][i].update(files=[{"s": "M", "p": "docs/readme.md"}], nFiles=5, **put)
            with self.subTest(i=i, put=put):
                self.assertTrue(any("file paths on a commit that is not public" in b for b in self.gate(forged, ctx)))

    def test_files_follow_the_exporters_own_visibility_verdict(self):
        """A commit flagged public but private elsewhere (H1) loses its paths with its name."""
        self.page["today"]["byProject"].append({"project": "IT-Passport-Learning", "public": False, "requests": 1, "costUsd": 0.1})
        pub, ctx = self.run_export()
        a = pub["activity"][0]
        self.assertEqual((a["public"], a.get("files"), a["nFiles"], a["author"]), (False, None, 4, None))
        self.assertEqual(self.gate(pub, ctx), [])

    def test_a_bad_path_degrades_that_commit_only(self):
        """A path with a private name, term, commit id, branch part, keyword or a pattern the gate flags
        drops that commit's list (count kept); other commits keep theirs and the gate passes. The same
        paths in a hand-made snapshot are refused by the gate (tests/redteam block-files-*)."""
        self.page["activity"][3]["branch"] = "wip/marmotte"                       # a private branch part
        bad = ["src/falcon_ledger/rules.py", "lib/OrchidBatch.ts", "x/owl/config.py", "notes/e1f2a3b.md",
               "docs/marmotte.md", "plans/Project_Nightjar.md", "docs/team@example.com", "img/logo" + "@" + "2x.png", "releases/203.0.113.7/n.md",
               "ops/box.tail1a2b.ts.net.md", "web/" + "home" + "/x.js", "docs/a%2Fb.md", "docs/a&amp;b.md", "docs/it's.md",
               "docs/a:b.md", "x/~/y.md", "keys/ghp_" + "A1b2C3d4" * 5 + ".txt", "docs/a\u200bb.md", "docs/dotfiles-sandbox.md",
               "deploy/studio-dev.yml", "/etc/hosts.md", "a/../b.md", "a//b.md", "d/" * 160 + "x.md"]
        for p in bad:
            with self.subTest(p):
                page = copy.deepcopy(self.page)
                page["activity"][0].update(files=[{"s": "A", "p": "docs/ok.md"}, {"s": "M", "p": p}], nFiles=9)
                page["activity"][2].update(files=[{"s": "M", "p": "docs/domains/AE.md"}], nFiles=1)
                pub, ctx = self.run_export(page)
                self.assertNotIn("files", pub["activity"][0])
                self.assertEqual(pub["activity"][0]["nFiles"], 9)
                self.assertEqual(pub["activity"][2]["files"], [{"s": "M", "p": "docs/domains/AE.md"}])
                self.assertEqual(self.gate(pub, ctx), [])
                self.assertEqual(self.gate(pub, ctx, html=True), [])

    def test_awkward_but_clean_paths_are_kept_and_pass_the_gate(self):
        ok = ["docs/日本語 notes (v2).md", ".github/workflows/ci.yml", "web/vendor/uplot.min.js", "a b/c+d,e[1]#!$.txt",
              "tests/redteam/samples/pass-minimal.json", "README.zh.md", "src/@scope/pkg/index.ts", "Makefile",
              "app/[id]/page.tsx", "app/(site)/layout.tsx", "src/MyApp.Core/Program.cs", "ios/App.xcodeproj/project.pbxproj",
              "docs/ADR-001.md", ".claude/settings.local.json", "v1.2.3.4/notes.md", "assets/" + "ab12" * 10 + ".png"]
        self.files_on(0, ok, n=12)
        pub, ctx = self.run_export()
        self.assertEqual([f["p"] for f in pub["activity"][0]["files"]], ok)
        self.assertEqual(self.gate(pub, ctx), [])
        self.assertEqual(self.gate(pub, ctx, html=True), [])

    def test_private_project_as_branch_part_keeps_substring_mode(self):
        """Review R09 M1: a privateProjects word (not on the page) that is also a private branch part is
        matched as a substring by the gate; the exporter must match it the same way, so a path or
        title that merely contains it degrades instead of the gate refusing the snapshot."""
        cfg = write_cfg(self.tmp.name, CFG_TEXT.replace("example-owner", "hakupao")
                        .replace('privateProjects = ["dotfiles-sandbox"', 'privateProjects = ["dotfiles-sandbox", "zephyrine"'))
        self.page["activity"][3]["branch"] = "zephyrine/topic"
        self.files_on(0, ["docs/zephyrinex.md"])
        self.page["activity"][2]["title"] = "docs: zephyrinex notes"
        pub, ctx = self.run_export(cfg=cfg)
        self.assertNotIn("files", pub["activity"][0])
        self.assertEqual(pub["activity"][2]["title"], "docs:")
        self.assertEqual(self.gate(pub, ctx), [])

    def test_paths_joined_to_their_neighbours_degrade(self):
        """Review R09 security M1: the gate reads the serialized snapshot as one stream, so "p" + "ixel-forge/..."
        or "docs/field-note" + the next entry's "s" spells a private project. Only the commits whose lists
        cause it lose them; the count is kept and reported; JSON and HTML pass the gate."""
        cfg = write_cfg(self.tmp.name, CFG_TEXT.replace("example-owner", "hakupao"))
        self.assertTrue({"pixel-forge", "field-notes"} <= cfg["privateProjects"])
        for lst in (["ixel-forge/readme.md"], ["docs/field-note", "b.md"]):
            with self.subTest(lst):
                page = copy.deepcopy(self.page)
                page["activity"][0].update(files=[{"s": "M", "p": x} for x in lst], nFiles=len(lst))
                page["activity"][2].update(files=[{"s": "M", "p": "docs/domains/AE.md"}], nFiles=1)
                pub, ctx = self.run_export(page, cfg)
                self.assertNotIn("files", pub["activity"][0])
                self.assertEqual(pub["activity"][0]["nFiles"], len(lst))
                self.assertEqual(pub["activity"][2]["files"], [{"s": "M", "p": "docs/domains/AE.md"}])
                self.assertEqual(ctx["degraded"]["filesJoined"], 1)
                self.assertEqual(self.gate(pub, ctx), [])
                self.assertEqual(self.gate(pub, ctx, html=True), [])
                forged = copy.deepcopy(pub)
                forged["activity"][0]["files"] = [{"s": "M", "p": x} for x in lst]
                self.assertTrue(any("private name" in b for b in self.gate(forged, ctx)))
        page = copy.deepcopy(self.page)                          # a lone "docs/field-note" joins nothing: kept
        page["activity"][0].update(files=[{"s": "M", "p": "docs/field-note"}], nFiles=1)
        pub, ctx = self.run_export(page, cfg)
        self.assertEqual(pub["activity"][0]["files"], [{"s": "M", "p": "docs/field-note"}])
        self.assertEqual(self.gate(pub, ctx), [])

    def bundled(self, pub):
        """Gate on index.html as hub/page.py html() builds it (with its "<" escaping)."""
        from hub import page as hp
        g = vp.Gate(json.loads((RT / "terms.json").read_text(encoding="utf-8")), self.last_input,
                    vp.load_toml(Path(self.tmp.name) / "public.toml"))
        tmpl = (f'<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="{vp.CSP}"></head>'
                f"<body>{hp.MARKER}</body></html>")
        p = Path(self.tmp.name) / "index.html"
        p.write_text(hp.html(pub, tmpl), encoding="utf-8")
        return g.check_file(p)

    def joined_title(self, prep, title, harmless, cut, key="title", count="titlesJoined", n=1, i=0):
        """Export with `title` as activity[i][key] and with a harmless control value: only that value is
        degraded to `cut`, the count is n, every other commit equals the control, and JSON and bundled HTML
        pass the gate. Returns the export with the raw value put back, for the gate to refuse."""
        page = copy.deepcopy(self.page)
        prep(page)
        ctrl = copy.deepcopy(page)
        page["activity"][i][key], ctrl["activity"][i][key] = title, harmless
        pub_c, ctx_c = self.run_export(ctrl)
        self.assertEqual(pub_c["activity"][i][key], harmless)
        self.assertEqual(ctx_c["degraded"][count], 0)
        pub, ctx = self.run_export(page)
        self.assertEqual(pub["activity"][i][key], cut)
        self.assertEqual(ctx["degraded"][count], n)
        self.assertEqual(pub["activity"][:i] + pub["activity"][i + 1:], pub_c["activity"][:i] + pub_c["activity"][i + 1:])
        self.assertEqual(self.gate(pub, ctx), [])
        self.assertEqual(self.bundled(pub), [])
        forged = copy.deepcopy(pub)
        forged["activity"][i][key] = title
        return forged

    def test_branch_joined_to_the_next_key_is_nulled(self):
        """Backlog A6 (1): the public branch "feat/wild" + the next key "hash" spells the private project
        wild-hash. Only that commit's branch becomes null; the gate refuses the raw branch."""
        self.assertIn("wild-hash", self.cfg["privateProjects"])
        forged = self.joined_title(lambda p: None, "feat/wild", "feat/tidy", None, "branch", "branchesJoined")
        self.assertTrue(any("private name" in b for b in self.gate(forged)))
        # A6 (2) for branches: a ref the gate decodes into a private word is masked, not published.
        self.page["activity"][0]["branch"] = "feat/o'+'wl"
        pub, ctx = self.run_export()
        self.assertEqual(pub["activity"][0]["branch"], {"masked": True})
        self.assertEqual(self.gate(pub, ctx), [])
        self.assertEqual(self.bundled(pub), [])

    def test_title_with_literal_escapes_is_cut(self):
        """Backlog A6 (2): the gate decodes \\u, \\x, CSS escapes and 'a'+'b' (every layer), so a title that
        spells a private word or a pattern only once decoded, alone or joined to the next key, is cut to its
        prefix. A harmless escape stays as written; the gate refuses every raw title."""
        for title, joined in (("docs: \\u006fwl notes", 0), ("docs: \\x6fwl notes", 0), ("docs: \\6f wl notes", 0),
                              ("docs: 'o'+'wl' notes", 0), ("docs: \\u{6f}wl notes", 0), ("docs: ops\\u0040example.com", 0),
                              ("docs: ping 203.0.113\\x2e7", 0), ("docs: open ftp\\u003a\\x2f\\x2fbox", 0),
                              ("docs: n\\u006fte", 1), ("docs: n\\x6fte", 1)):
            with self.subTest(title):
                forged = self.joined_title(lambda p: None, title, "docs: \\u0041 tidy", "docs:", n=joined)
                self.assertTrue(self.gate(forged))
        self.page["activity"][0]["title"] = "fix: match \\d+ digits"
        pub, ctx = self.run_export()
        self.assertEqual(pub["activity"][0]["title"], "fix: match \\d+ digits")
        self.assertEqual(self.gate(pub, ctx), [])

    def test_gate_layers_match_the_gate(self):
        """The exporter's copy of the gate's decoding (no shared code) gives the same layers."""
        for s in ("plain", "\\u006fwl", "\\u{1F600}x", "\\x6f\\x77l", "\\6f wl", "&#x6f;&amp;lt;", "a\\/b", "%25%36%66",
                  "'o'+'wl'", '"o" + "wl"', "`o`+`wl`", "\\u{110000}", "\\uZZZZ", "&lt;b12", "%u006f",
                  "\\\\u0035\\u0035" * 3, json.dumps({"t": "\\u006fwl", "b": "o'+'wl"})):
            with self.subTest(s):
                self.assertEqual(ex.gate_layers(s), vp.decodings(s))

    def test_gate_patterns_match_the_gate(self):
        """A8: the exporter's copy of the gate's patterns (no shared code): same expressions, same findings."""
        self.assertEqual({k: r.pattern for k, r in ex.GATE_PATTERNS.items()}, {k: r.pattern for k, r in vp.PATTERNS.items()})
        for mine, theirs in ((ex.GATE_ABS_URL, vp.ABS_URL), (ex.GATE_REL_URL, vp.REL_URL), (ex.GATE_XMLNS, vp.XMLNS),
                             (ex.GATE_PROTO_REL, vp.PROTO_REL)):
            self.assertEqual(mine.pattern, theirs.pattern)
        url_rx = ex.public_url_rx({"sdtm-pedia"}, {"hakupao"})

        def gate_finds(t):
            out = [(k, m.group(0)) for k, rx in vp.PATTERNS.items() for m in rx.finditer(t)]
            out += [("url", u) for m in vp.ABS_URL.finditer(t) if not (vp.XMLNS.fullmatch(u := m.group(0).rstrip(".,;"))
                                                                      or url_rx.fullmatch(u))]
            return out + [("rel", m.group(0)) for rx in (vp.REL_URL, vp.PROTO_REL) for m in rx.finditer(t)]
        for s in ('"fix: a\\\\r\\\\n b"', '"x": "//cdn.example.com"', "ops@example.com", "203.0.113.7", "fd7a:115c::1",
                  "/" + "Users/x", "C:\\\\x", "box.tail1a2b.ts.net", "token = abcd1234", "https://example.com/a.",
                  "https://github.com/hakupao/sdtm-pedia/commit/4be0d71", "http://www.w3.org/2000/svg", 'src="//a.b',
                  "url(//a.b)", "https:\\\\a.b", "=//a.b", "plain words, nothing here"):
            with self.subTest(s):
                self.assertEqual(ex.pattern_hits(s, url_rx), gate_finds(s))
                self.assertEqual(bool(gate_finds(s)), s != "plain words, nothing here" and "sdtm-pedia" not in s and "w3.org" not in s)

    def test_title_or_branch_the_gate_reads_as_a_pattern_is_degraded(self):
        """Backlog A8: "\\r\\n" is written "\\\\r\\\\n" in the JSON, which the gate reads as a \\\\host\\ path; '"//host'
        in a title reads as a protocol-relative URL. That title is cut to its prefix, that branch becomes null;
        the page JSON (as --out writes it, indent=1, and compact) and the bundle pass; the gate refuses the raw value."""
        for title, cut, n in (("fix: normalise \\r\\n line endings", "fix:", 1), ("fix: a\\tb\\tc", "fix:", 1)):
            with self.subTest(title):
                forged = self.joined_title(lambda p: None, title, "fix: normalise line endings", cut, n=n)
                self.assertTrue(any("path" in b for b in self.gate(forged)))
                self.assertEqual(self.gate_indented(self.run_export(self.page_with(0, "title", title))), [])
        forged = self.joined_title(lambda p: None, "feat\\b\\c", "feat/b-c", None, "branch", "branchesJoined")
        self.assertTrue(any("path" in b for b in self.gate(forged)))
        # The same text in the title and the branch of one commit: two hits, both values degrade (fuzz seed 3).
        page = self.page_with(0, "branch", "feat\\b\\c")
        page["activity"][0]["title"] = "wip\\b\\c"
        pub, ctx = self.run_export(page)
        self.assertEqual((pub["activity"][0]["title"], pub["activity"][0]["branch"]), (ex.RED, None))
        self.assertEqual((ctx["degraded"]["titlesJoined"], ctx["degraded"]["branchesJoined"]), (1, 1))
        self.assertEqual(self.gate(pub, ctx), [])
        self.assertEqual(self.gate_indented((pub, ctx)), [])
        self.page["activity"][0]["title"] = 'docs: load "//cdn.example.com here'
        pub, ctx = self.run_export()
        self.assertEqual(self.gate(pub, ctx), [])
        self.assertEqual(self.bundled(pub), [])
        forged = copy.deepcopy(pub)
        forged["activity"][0]["title"] = 'docs: load "//cdn.example.com here'
        self.assertTrue(any("protocol-relative" in b for b in self.gate(forged)))

    def page_with(self, i, key, value):
        page = copy.deepcopy(self.page)
        page["activity"][i][key] = value
        return page

    def gate_indented(self, exported):
        """Gate on the page JSON exactly as `--out` writes it (indent=1)."""
        pub, _ = exported
        g = vp.Gate(json.loads((RT / "terms.json").read_text(encoding="utf-8")), self.last_input,
                    vp.load_toml(Path(self.tmp.name) / "public.toml"))
        p = Path(self.tmp.name) / "page.public.json"
        p.write_text(json.dumps(pub, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        return g.check_file(p)

    def test_prefix_that_still_joins_is_masked(self):
        """Backlog A6 (3): "perf: note" + "branch" spells note-branch; its prefix "perf:" + "branch" spells
        perf-branch. The title is masked to ******, the form CONTRACT §3 allows any title; a private commit
        whose title is already only that prefix is masked too. Other titles are kept."""
        self.assertIn("perf-branch", self.cfg["privateProjects"])
        forged = self.joined_title(lambda p: None, "perf: note", "perf: tidy", ex.RED)
        self.assertTrue(any("private name" in b for b in self.gate(forged)))
        # A8 review: a literal tab / newline reads "\t" / "\n" in the JSON but vanishes in the gate's raw join of
        # keys and strings, where "perf:" + "branch" spells perf-branch.
        for ws in ("\t", "\n"):
            with self.subTest(repr(ws)):
                forged = self.joined_title(lambda p: None, "perf:" + ws, "fix:" + ws, ex.RED)
                self.assertTrue(any("private name" in b for b in self.gate(forged)))
        # Full text and prefix join the same way: the mask is reached directly, earlier titles stay.
        forged = self.joined_title(lambda p: None, "perf: ---", "fix: ---", ex.RED, i=2)
        self.assertTrue(any("private name" in b for b in self.gate(forged)))
        self.cfg = write_cfg(self.tmp.name, CFG_TEXT.replace("example-owner", "hakupao")
                             .replace('privateTitles = "redacted"', 'privateTitles = "prefix-only"'))
        self.assertEqual(self.cfg["privateTitles"], "prefix-only")
        forged = self.joined_title(lambda p: None, "perf:", "fix:", ex.RED, i=3)
        self.assertTrue(any("private name" in b for b in self.gate(forged)))

    def test_title_joined_to_the_next_key_is_cut_to_its_prefix(self):
        """Backlog A5 (1): "docs: note" + the next key "branch" spells the private project note-branch. With or
        without file lists on the page, only that title is cut; the gate refuses the raw title."""
        self.assertIn("note-branch", self.cfg["privateProjects"])

        def no_files(p):
            for a in p["activity"]:
                a.update(files=None, nFiles=None)
        for how, prep in (("no file lists", no_files), ("file lists", lambda p: None)):
            with self.subTest(how):
                forged = self.joined_title(prep, "docs: note", "docs: tidy", "docs:")
                self.assertTrue(any("private name" in b for b in self.gate(forged)))
        page = copy.deepcopy(self.page)                          # two such titles: both cut, the loop ends
        page["activity"][0]["title"] = page["activity"][1]["title"] = "docs: note"
        pub, ctx = self.run_export(page)
        self.assertEqual((pub["activity"][0]["title"], pub["activity"][1]["title"]), ("docs:", "docs:"))
        self.assertEqual(ctx["degraded"]["titlesJoined"], 2)
        self.assertEqual(self.gate(pub, ctx), [])

    def test_title_spelling_a_private_id_only_when_escaped_is_cut(self):
        """Backlog A5 (2): html() writes "<" as \\u003c, so "<b12" spells the private commit id 003cb12 in
        index.html only. The exporter checks both forms; the gate refuses the raw title in the bundle."""
        def prep(p):
            p["activity"][3]["hash"] = "003cb12"
        forged = self.joined_title(prep, "fix: render <b12 tag", "fix: render <b tag", "fix:")
        self.assertEqual(self.gate(forged), [])                  # the JSON form spells nothing
        self.assertTrue(any("private name" in b for b in self.bundled(forged)))

    def test_escaped_form_matches_the_bundler(self):
        """The exporter's copy of html()'s escaping: a word formed only by the escape is found by both."""
        from hub import page as hp
        for c in ("<", " ", " "):
            with self.subTest(hex(ord(c))):
                term = "u%04xzqk" % ord(c)
                m = ex.Matcher([term], {})
                node = {"t": c + "zqk"}
                self.assertFalse(m.hits(json.dumps(node, ensure_ascii=False)))
                self.assertEqual(m.hits(hp.html(node, hp.MARKER)), {term})
                self.assertEqual(ex._hits(node, m), {term})

    def test_a_clean_page_costs_one_scan(self):
        """No hit: one whole-page scan, nothing changed."""
        pub, ctx = self.run_export()
        before = copy.deepcopy(pub)
        m = ex.Matcher(["falcon-ledger"], {})
        m.url_rx = ex.public_url_rx(ctx["publicRepos"], self.cfg["githubOwners"])     # as export() sets it
        calls = []
        orig = m.hits
        m.hits = lambda t: calls.append(1) or orig(t)
        ex._no_joined_names(pub, m, collections.Counter())
        self.assertEqual((len(calls), pub), (1, before))

    def test_decoding_a_commit_adds_no_whole_page_scan(self):
        """A6: a title with something to decode is decoded on its own commit; a page without hits still
        costs one whole-page scan per form."""
        self.page["activity"][0]["title"] = "fix: match \\d+ digits"
        pub, ctx = self.run_export()
        before = copy.deepcopy(pub)
        m = ex.Matcher(["falcon-ledger"], {})
        m.url_rx = ex.public_url_rx(ctx["publicRepos"], self.cfg["githubOwners"])     # as export() sets it
        sizes = []
        orig = m.hits
        m.hits = lambda t: sizes.append(len(t)) or orig(t)
        ex._no_joined_names(pub, m, collections.Counter())
        self.assertEqual(pub, before)
        self.assertGreater(len(sizes), 1)                        # the commit's decoded layers were scanned
        self.assertEqual(sum(n > len(ex._serial(pub)) // 2 for n in sizes), 1)

    def test_one_join_costs_a_constant_number_of_page_scans(self):
        """Security review of A6: with one joined title among N commits (a name, or an A8 pattern), the number of
        whole-page scans does not grow with N (the fallback stops as soon as the page is clean)."""
        orig = ex._hits
        counts = {}
        for n, (title, cut) in ((n, t) for t in (("docs: note", "docs:"), ("docs: a\\tb\\tc", "docs:")) for n in (20, 40, 80)):
            page = copy.deepcopy(self.page)
            extra = [dict(copy.deepcopy(page["activity"][2]), hash=f"{i:07x}", title=f"docs: tidy {i}") for i in range(n)]
            page["activity"] = page["activity"][:3] + extra + page["activity"][3:]
            page["activity"][0]["title"] = title
            calls = []

            def spy(node, matcher):
                if isinstance(node.get("activity"), list):
                    calls.append(1)
                return orig(node, matcher)
            ex._hits = spy
            try:
                pub, ctx = self.run_export(page)
            finally:
                ex._hits = orig
            self.assertEqual((pub["activity"][0]["title"], ctx["degraded"]["titlesJoined"]), (cut, 1))
            counts[title, n] = len(calls)
        for title in ("docs: note", "docs: a\\tb\\tc"):
            self.assertEqual(len({v for (t, _), v in counts.items() if t == title}), 1, counts)

    def test_listed_fragment_never_frees_a_component_of_a_private_name(self):
        """Review R09 security L2: "Falcon-Tools" listed exempts "tools" but not "falcon", a component of the
        private repo falcon-ledger; both sides agree."""
        cfg = write_cfg(self.tmp.name, 'branchFragments = ["Falcon-Tools"]\n' + UNLISTED.replace("example-owner", "hakupao"))
        self.page["activity"][3]["branch"] = "falcon-tools/tune"
        self.page["activity"][0]["title"] = "docs: tools for falcon"
        pub, ctx = self.run_export(cfg=cfg)
        self.assertIn("falcon", ctx["privateNames"])
        self.assertNotIn("tools", ctx["privateNames"])
        self.assertEqual(pub["activity"][0]["title"], "docs:")
        self.assertEqual(self.gate(pub, ctx), [])
        g = vp.derive(self.page, set(), fragments=["Falcon-Tools"], protected=["owl"])
        self.assertIn("falcon", g[1])
        self.assertNotIn("tools", g[1])

    def test_degradations_are_counted_without_names(self):
        self.page["activity"][3]["branch"] = "hakupao/secret-topic"                 # login unlisted: links and author go
        self.files_on(0, ["src/falcon_ledger/x.py"])
        pub, ctx = self.run_export(cfg=write_cfg(self.tmp.name, UNLISTED.replace("example-owner", "hakupao")))
        d = ctx["degraded"]
        self.assertEqual((d["filesDropped"], d["linksDropped"], d["authorsDropped"]), (1, 3, 4))      # 3 links, 4 public commits
        self.assertTrue(all(isinstance(v, int) for v in d.values()))
        src = Path(self.tmp.name) / "private.json"
        src.write_text(json.dumps(self.page), encoding="utf-8")
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            rc = ex.main([str(src), "--config", str(Path(self.tmp.name) / "public.toml"), "--terms", str(RT / "terms.json"),
                          "--out", str(Path(self.tmp.name) / "o.json")])
        self.assertEqual(rc, 0)
        self.assertIn("export degraded (counts): filesDropped 1, linksDropped 3, authorsDropped 4", err.getvalue())
        self.assertNotIn("falcon", err.getvalue())

    def test_gate_folds_every_look_alike_the_exporter_folds(self):
        """Review R09 security L1: the gate's look-alike table covers the exporter's."""
        for k, v in ex.HOMOGLYPHS.items():
            with self.subTest(chr(k)):
                self.assertEqual(vp.LOOKALIKE.get(k), v)

    def test_malformed_file_entries_degrade_that_commit_only(self):
        for bad in ({"s": "X", "p": "a.md"}, {"s": "modified", "p": "a.md"}, {"s": "m", "p": "a.md"}, {"p": "a.md"},
                    {"s": "M"}, {"s": "M", "p": 3}, {"s": "M", "p": None}, "a.md", None, ["M", "a.md"]):
            with self.subTest(bad):
                page = copy.deepcopy(self.page)
                page["activity"][0].update(files=[{"s": "A", "p": "docs/ok.md"}, bad], nFiles=2)
                pub, ctx = self.run_export(page)
                self.assertNotIn("files", pub["activity"][0])
                self.assertEqual(pub["activity"][0]["nFiles"], 2)
                self.assertEqual(pub["activity"][2]["files"], [{"s": "M", "p": "docs/domains/AE.md"}])
                self.assertEqual(self.gate(pub, ctx), [])
        page = copy.deepcopy(self.page)
        page["activity"][0].update(files="docs/ok.md", nFiles=1)                   # not a list at all
        pub, ctx = self.run_export(page)
        self.assertNotIn("files", pub["activity"][0])
        self.assertEqual(self.gate(pub, ctx), [])

    def test_files_truncated_to_50_and_n_is_the_true_count(self):
        self.files_on(0, [f"src/f{i}.py" for i in range(80)], n=None)
        self.page["activity"][0]["nFiles"] = None                                  # count unknown: the list length
        pub, ctx = self.run_export()
        self.assertEqual((len(pub["activity"][0]["files"]), pub["activity"][0]["nFiles"]), (50, 80))
        self.assertEqual(self.gate(pub, ctx), [])
        forged = copy.deepcopy(pub)
        forged["activity"][0]["files"].append({"s": "M", "p": "src/extra.py"})
        self.assertTrue(any("more than 50 files" in b for b in self.gate(forged, ctx)))

    def test_nfiles_is_optional_and_a_count(self):
        for v, want in ((None, None), (0, 0), (3, 3), (-1, None), (2.5, None), ("3", None), (True, None)):
            page = copy.deepcopy(self.page)
            page["activity"][3]["nFiles"] = v
            for a in page["activity"]:                                             # an old probe: no new keys at all
                if a is not page["activity"][3]:
                    for k in ("nFiles", "files", "author"):
                        a.pop(k, None)
            with self.subTest(v=v):
                pub, ctx = self.run_export(page)
                self.assertEqual(pub["activity"][3]["nFiles"], want)
                self.assertEqual(self.gate(pub, ctx), [])

    def test_author_only_configured_and_only_on_public_commits(self):
        pub, ctx = self.run_export()
        self.assertEqual([a["author"] for a in pub["activity"]], ["hakupao" if a["public"] else None for a in pub["activity"]])
        self.assertEqual(self.gate(pub, ctx), [])
        for i in range(len(self.page["activity"])):
            self.page["activity"][i]["author"] = "someone-else"                    # not configured: null
        pub, ctx = self.run_export()
        self.assertTrue(all(a["author"] is None for a in pub["activity"]))
        cfg = write_cfg(self.tmp.name, CFG_TEXT.replace("example-owner", "hakupao").replace('authors = ["hakupao"]\n', ""))
        page = copy.deepcopy(EXAMPLE)                                              # no authors configured: never shown
        pub, ctx = self.run_export(page, cfg)
        self.assertTrue(all(a["author"] is None for a in pub["activity"]))
        self.assertEqual(self.gate(pub, ctx), [])
        forged = copy.deepcopy(pub)
        forged["activity"][0]["author"] = "hakupao"
        self.assertTrue(any("is not author" in b for b in self.gate(forged, ctx)))

    def test_login_as_private_branch_part_needs_branch_fragments(self):
        """R10 (D4): a private branch "<login>/topic" makes the login a private name. Unlisted, the
        exporter drops the author and the commit links that spell it, and the gate passes; listed in
        branchFragments, both stay. The gate refuses the login where it was not dropped."""
        self.page["activity"][3]["branch"] = "hakupao/secret-topic"
        pub, ctx = self.run_export(cfg=write_cfg(self.tmp.name, UNLISTED.replace("example-owner", "hakupao")))
        self.assertIn("hakupao", ctx["privateNames"])
        self.assertTrue(all(a["author"] is None and a["url"] is None for a in pub["activity"]))
        self.assertEqual(self.gate(pub, ctx), [])
        forged = copy.deepcopy(pub)
        forged["activity"][0]["author"] = "hakupao"
        self.assertTrue(any("private name" in b for b in self.gate(forged, ctx)))
        cfg = write_cfg(self.tmp.name, 'branchFragments = ["hakupao"]\n' + UNLISTED.replace("example-owner", "hakupao"))
        pub, ctx = self.run_export(cfg=cfg)
        self.assertNotIn("hakupao", ctx["privateNames"])
        self.assertTrue({"secret", "topic"} <= set(ctx["privateNames"]))           # the other parts stay private
        self.assertEqual(pub["activity"][0]["author"], "hakupao")
        self.assertTrue(pub["activity"][0]["url"])
        self.assertEqual(self.gate(pub, ctx), [])

    def test_branch_fragments_are_split_and_only_exempt_branch_parts(self):
        """A4: parts of a hyphenated public repo name in a private branch stay private unless listed (the
        owner's D4 choice over relaxing the rule), so the gate refuses the page that shows that repo.
        Listing "IT-Passport-Learning" exempts its parts; a listed word that is also a private repo
        name stays private (only branch parts are exempt)."""
        self.page["activity"][3]["branch"] = "Passport-Learning/notes"
        self.page["activity"][0]["title"] = "docs: Passport chapter"
        pub, ctx = self.run_export(cfg=write_cfg(self.tmp.name, UNLISTED.replace("example-owner", "hakupao")))
        self.assertTrue({"Passport", "Learning"} <= set(ctx["privateNames"]))
        self.assertEqual(pub["activity"][0]["title"], "docs:")
        self.assertTrue(any("private name" in b for b in self.gate(pub, ctx)))      # the repo name itself
        cfg = write_cfg(self.tmp.name, 'branchFragments = ["IT-Passport-Learning", "orchid-batch"]\n'
                        + UNLISTED.replace("example-owner", "hakupao"))
        pub, ctx = self.run_export(cfg=cfg)
        self.assertFalse({"Passport", "Learning"} & set(ctx["privateNames"]))
        self.assertEqual(pub["activity"][0]["title"], "docs: Passport chapter")
        self.assertIn("orchid-batch", ctx["privateNames"])
        self.assertEqual(self.gate(pub, ctx), [])
        forged = copy.deepcopy(pub)
        forged["activity"][0]["title"] = "docs: orchid-batch notes"
        self.assertTrue(any("private name" in b for b in self.gate(forged, ctx)))

    def test_new_config_keys_are_checked(self):
        for text in ('authors = "hakupao"\n', 'authors = ["not a login"]\n', 'authors = [""]\n',
                     'branchFragments = "x"\n', 'branchFragments = [""]\n', 'branchFragment = ["x"]\n'):
            with self.subTest(text), self.assertRaises(ex.ExportError):
                write_cfg(self.tmp.name, text)
        for cfg in ({"authors": "x"}, {"authors": ["not a login"]}, {"branchFragments": [3]}, {"branchFragments": [" "]}):
            with self.subTest(cfg), self.assertRaises(vp.SetupError):
                vp.check_config(cfg)

    # --- refusing --------------------------------------------------------------------------------

    def test_mistyped_values_raise(self):
        self.page["runtimes"][0]["version"] = "2.0.1+build.secrethost"       # L3: not published, nulled
        pub, _ = self.run_export()
        self.assertIsNone(pub["runtimes"][0]["version"])
        for put in (lambda p: p["today"].__setitem__("requests", {"zebra": 1}),    # dict where a number goes
                    lambda p: p["today"].__setitem__("costUsd", float("nan")),      # L6
                    lambda p: p["today"].__setitem__("requests", "120")):
            page = copy.deepcopy(EXAMPLE)
            put(page)
            with self.subTest(put), self.assertRaises(ex.ExportError):
                self.run_export(page=page)
        page = copy.deepcopy(EXAMPLE)
        page["schema"] = "something/else"
        with self.assertRaises(ex.ExportError):
            self.run_export(page=page)

    def test_bad_config_raises(self):
        for text in ('privateTitles = "none"\n', 'hidden = ["everything"]\n', '[allow]\n"today.requests" = ["1"]\n',
                     'hiden = ["tailnet"]\n', 'not toml ['):
            with self.subTest(text), self.assertRaises(ex.ExportError):
                write_cfg(self.tmp.name, text)

    def test_terms_schema(self):
        for bad in ({"term": ["x"]}, {"terms": []}, {"terms": ["ok", ""]}, {"terms": ["ok", 3]},
                    {"terms": ["ok"], "allow": "x"}, {"terms": ["ok"], "match": {"ok": "fuzzy"}}, ["ok"]):
            p = Path(self.tmp.name) / "terms.json"
            p.write_text(json.dumps(bad), encoding="utf-8")
            with self.subTest(bad), self.assertRaises(ex.ExportError):
                ex.load_terms(p)

    def test_codes_must_not_be_private(self):
        p = Path(self.tmp.name) / "c.toml"
        p.write_text('codes = ["owl"]\n', encoding="utf-8")
        with self.assertRaises(ex.ExportError):
            ex.load_config(p, self.terms)                              # a code on the word list
        p.write_text('codes = ["studio-dev"]\n', encoding="utf-8")
        with self.assertRaises(ex.ExportError):
            self.run_export(cfg=ex.load_config(p, self.terms))         # a code equal to a private name

    def test_low_title_patterns(self):
        m = ex.Matcher([], {})
        for t in ["deploy: hub at box.tail1a2b.ts.net", "docs: see wiki.acmecorp.internal/page",
                  "chore: rotate sk_live_51HxAbCdEfGhIjKlMnOp", "test: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc",
                  "ci: npm_" + "a1B2c3D4" * 4, "ci: hf_" + "a1B2c3D4" * 4, "fix D:" + "\\work\\acme\\x",
                  "docs: see docs.example.com/guide"]:
            with self.subTest(t):
                out = ex.scrub_title(t, m)
                self.assertIn("******", out)
                g = vp.Gate(json.loads((RT / "terms.json").read_text(encoding="utf-8")), None, {})
                self.assertEqual(g.title_problems(out), [], out)                         # exporter ⊇ gate
                self.assertTrue(g.title_problems(t))

    def test_cli_errors_are_masked(self):
        src = Path(self.tmp.name) / "private.json"
        src.write_text("[1, 2]", encoding="utf-8")                                     # not even an object
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            rc = ex.main([str(src), "--no-config", "--terms", str(RT / "terms.json"),
                          "--out", str(Path(self.tmp.name) / "o.json")])
        self.assertEqual(rc, 2)
        self.assertNotIn("Traceback", err.getvalue())

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
