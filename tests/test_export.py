"""Public exporter (S11): whitelist rebuild, masking, scrubbing; its output must pass the gate.
All data is fabricated (schema/examples/ and the red-team context)."""
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
