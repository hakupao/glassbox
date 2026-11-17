"""Regenerate the red-team samples and cases.json (fabricated data only).

    python3 tests/redteam/make_samples.py

Values the repo's privacy scan would flag (home paths, GitHub tokens) are written as
{{PLACEHOLDERS}} and assembled by tests/test_redteam.py at load time.
"""
import copy
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
S = OUT / "samples"
BASE = {
 "schema": "glassbox.page/1", "view": "public", "generatedAt": "2026-11-17T10:30:00+09:00",
 "tz": "Asia/Tokyo", "pricingVersion": "2026-11-17",
 "today": {"requests": 120, "sessions": 3, "unpricedRequests": 0, "cacheHitRate": 0.8, "costUsd": 4.2,
           "byModel": [{"model": "claude-opus-5-5", "agent": "claude-code", "requests": 100, "costUsd": 4.0},
                       {"model": "other", "agent": "codex", "requests": 20, "costUsd": None}],
           "byProject": [{"project": "sdtm-pedia", "public": True, "requests": 70, "costUsd": 2.5},
                         {"project": {"masked": True, "group": "private"}, "public": False, "requests": 50, "costUsd": 1.7}]},
 "activity": [
  {"t": "2026-11-17T10:12:00+09:00", "source": "github", "repo": "sdtm-pedia", "public": True,
   "title": "docs: bowling score example for v1.2.3 at 10:30", "branch": "main", "hash": "4be0d71",
   "url": "https://github.com/example-owner/sdtm-pedia/commit/4be0d71", "machine": "A", "pushed": True},
  {"t": "2026-11-17T09:00:00+09:00", "source": "local", "repo": {"masked": True}, "public": False,
   "title": "fix: handle empty mapping rule", "branch": None, "hash": None, "url": None, "machine": None, "pushed": False}],
 "services": [{"name": "gitea", "kind": "both", "machine": "V", "status": "up", "uptimePct24h": 100.0, "cpuPct": 0.4, "memBytes": 2.1e8},
              {"name": {"masked": True}, "kind": "container", "machine": "V", "status": "down", "uptimePct24h": None, "cpuPct": None, "memBytes": None}],
 "tailnet": [], "hidden": ["tailnet"],
}
cases = []
def js(name, why, expect, reason, mut=None, obj=None):
    o = copy.deepcopy(BASE) if obj is None else obj
    if mut: mut(o)
    (S / f"{name}.json").write_text(json.dumps(o, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    cases.append({"file": f"{name}.json", "expect": expect, "reason": reason, "why": why})
def act(o): return o["activity"][0]
def priv(o): return o["activity"][1]
def title(t): return lambda o: act(o).__setitem__("title", t)

js("pass-minimal", "valid public page: merged private row, model other, private commit done right, 'owl' only inside 'bowling'", "pass", None)
js("block-unknown-top-key", "rule 1: key not in the table", "block", "field not in public_fields.json", lambda o: o.__setitem__("notes", "x"))
js("block-unknown-nested-key", "rule 1: author on a commit", "block", "field not in public_fields.json", lambda o: act(o).__setitem__("author", "someone"))
js("block-hourly", "rule 7: today.hourly never public", "block", "field not in public_fields.json", lambda o: o["today"].__setitem__("hourly", [{"hour": 9, "requests": 3, "costUsd": 0.1}]))
js("block-masked-extra-key", "placeholder carrying a length hint", "block", "placeholder must be exactly", lambda o: o["services"][1].__setitem__("name", {"masked": True, "len": 13}))
js("block-group-outside-byproject", "merged-row placeholder only allowed in today.byProject", "block", "placeholder must be exactly", lambda o: o["services"][1].__setitem__("name", {"masked": True, "group": "private"}))
js("block-text-not-allowlisted", "rule 2: service name not on the allowlist", "block", "is not text", lambda o: o["services"][1].__setitem__("name", "warehouse-sync"))
js("block-text-private-name", "rule 2+6: a known private service name in clear", "block", "private name", lambda o: o["services"][1].__setitem__("name", "billing-api"))
js("block-number-as-string", "rule 3: number", "block", "is not number", lambda o: o["today"].__setitem__("requests", "120"))
js("block-bool-as-number", "rule 3: bool is not a number", "block", "is not number", lambda o: o["today"].__setitem__("sessions", True))
js("block-iso", "rule 3: iso", "block", "is not iso", lambda o: o.__setitem__("generatedAt", "yesterday"))
js("block-enum", "rule 3: closed enum", "block", "is not enum", lambda o: o.__setitem__("tz", "Europe/Berlin"))
js("block-const", "rule 3: view must be public", "block", "is not const", lambda o: o.__setitem__("view", "private"))
js("block-hash", "rule 3: hash", "block", "is not hash", lambda o: act(o).__setitem__("hash", "HEAD~1"))
js("block-code", "rule 3: machine code", "block", "is not code", lambda o: o["services"][0].__setitem__("machine", "studio"))
js("block-model", "rule 3: model outside the price table", "block", "is not model", lambda o: o["today"]["byModel"][0].__setitem__("model", "internal-model-x"))
js("block-url-private-repo", "rule 3: commit link to a repo that is not public", "block", "is not url:public-repo", lambda o: act(o).__setitem__("url", "https://github.com/example-owner/warehouse-sync/commit/4be0d71"))
js("block-url-other-owner", "rule 3: link under an owner that is not configured", "block", "is not url:public-repo", lambda o: act(o).__setitem__("url", "https://github.com/someone-else/sdtm-pedia/commit/4be0d71"))
js("block-list-where-leaf", "rule 3: list in a leaf", "block", "where", lambda o: o["today"].__setitem__("costUsd", [1, 2]))
js("block-r4-branch", "rule 4: private commit keeps its branch", "block", "private commit keeps branch", lambda o: priv(o).__setitem__("branch", "main"))
js("block-r4-hash", "rule 4: private commit keeps its hash", "block", "private commit keeps hash", lambda o: priv(o).__setitem__("hash", "e1f2a3b"))
js("block-r4-url", "rule 4: private commit keeps a (public-looking) url", "block", "private commit keeps url", lambda o: priv(o).__setitem__("url", "https://github.com/example-owner/sdtm-pedia/commit/4be0d71"))
js("block-r4-machine", "rule 4: private commit keeps its machine", "block", "private commit keeps machine", lambda o: priv(o).__setitem__("machine", "B"))
js("block-r4-time", "rule 4: private commit time not cut to the hour", "block", "not on the hour", lambda o: priv(o).__setitem__("t", "2026-11-17T09:48:00+09:00"))
js("block-r4-repo-shown", "rule 4: private commit shows an allowlisted repo name", "block", "private commit repo must be masked", lambda o: priv(o).__setitem__("repo", "sdtm-pedia"))
js("block-gitea-public", "Gitea commits are never public", "block", "gitea commits are never public", lambda o: act(o).update(source="gitea"))
js("block-byproject-unmerged", "private usage row not merged", "block", "merged private row", lambda o: o["today"]["byProject"].append({"project": {"masked": True}, "public": False, "requests": 1, "costUsd": 0.1}))
js("block-hidden-not-empty", "rule 7: hidden block still has rows", "block", "hidden block tailnet", lambda o: o.__setitem__("tailnet", [{"name": {"masked": True}, "os": "ios", "online": True, "lastSeen": "2026-11-17T10:00:00+09:00"}]))
js("block-hidden-byproject", "rule 7: hidden byProject still has rows", "block", "hidden block byProject", lambda o: o["hidden"].append("byProject"))
js("block-title-email", "S12: e-mail in a title", "block", "email", title("fix: reply to ops@example.com"))
js("block-title-ipv4", "S12: IP in a title", "block", "ipv4", title("chore: point probe at 203.0.113.7"))
js("block-title-ipv6", "S12: IPv6 in a title", "block", "ipv6", title("chore: listen on fd7a:115c:a1e0::1"))
js("block-title-ipv4-sentence-end", "S12: IP at the end of a sentence", "block", "ipv4", title("chore: deploy to 203.0.113.7."))
js("block-title-tilde-file", "S12: ~/file in a title", "block", "path", title("fix: edit ~/notes.md"))
js("block-title-home-inside", "S12: home dir inside a relative path", "block", "path", title("docs: move docs{{HOMEDIR}}index.md"))
js("block-private-project", "privateProjects: a public repo the owner keeps private", "block", "private name",
   lambda o: o["activity"].append(dict(copy.deepcopy(o["activity"][0]), repo="dotfiles-sandbox", url=None)))
js("block-config-hidden-missing", "config hides tailnet but the page does not list it", "block", "config hides tailnet",
   lambda o: o.__setitem__("hidden", []))
js("block-title-path", "S12: absolute path in a title", "block", "path", title("fix: read /srv/data/app.db"))
js("block-title-home-path", "S12: home path in a title (built at load time)", "block", "path", title("fix: read {{USERS}}someone/notes.md"))
js("block-title-tilde-path", "S12: ~ path in a title", "block", "path", title("fix: write ~/notes/plan.txt"))
js("block-title-secret-aws", "S12: secret in a title", "block", "secret", title("chore: rotate AKIAIOSFODNN7EXAMPLE"))
js("block-title-secret-kv", "S12: key=value secret in a title", "block", "secret", title("test: use password=hunter22 for login"))
js("block-title-secret-gh", "S12: GitHub token in a title (built at load time)", "block", "secret", title("ci: add {{GHP}}"))
js("block-title-ticket", "rule 5: ticket id", "block", "ticket", title("fix: ABC-123 crash"))
js("block-title-url", "rule 5: URL in a title", "block", "url", title("docs: see https://intranet.example.com/wiki"))
js("block-title-name-camel", "rule 6: private name, other spelling", "block", "private name", title("feat: sync with FalconLedger"))
js("block-title-name-snake", "rule 6: private name, snake case", "block", "private name", title("feat: port falcon_ledger rules"))
js("block-title-keyword", "rule 5: blocked keyword, other spelling", "block", "private name", title("docs: Project_Nightjar notes"))
js("block-short-word", "S12: short (<5) private name on a word boundary", "block", "private name", title("fix: owl config"))
js("block-short-word-in-text", "S12: short private name as a masked service leaking in clear", "block", "private name", lambda o: o["services"][1].__setitem__("name", "OWL"))
js("block-short-forced-substring", "per-term match mode: short term forced to substring", "block", "private name", title("test: fooqxbar"))
js("block-runtime-hash", "runtime private name: a private commit hash", "block", "private name", lambda o: act(o).__setitem__("hash", "e1f2a3b"))
js("block-runtime-name-in-key", "a private name smuggled in as a key", "block", "private name", lambda o: o["today"].__setitem__("orchid-batch", 1))
js("pass-word-mode-override", "term 'nightjar' set to word mode: 'nightjars' passes", "pass", None, title("docs: nightjars and owls"))

def page_js(o): return "window.GB = " + json.dumps(o, ensure_ascii=False) + ";"
def ht(name, why, expect, reason, head="", body="", data=None):
    o = copy.deepcopy(BASE) if data is None else data
    gb = "" if data is False else f"<script>{page_js(o)}</script>"
    doc = f"<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>glassbox</title>{head}<style>body{{background:#111}}</style></head>\n<body><main>\n{body}\n</main>{gb}</body></html>\n"
    (S / f"{name}.html").write_text(doc, encoding="utf-8")
    cases.append({"file": f"{name}.html", "expect": expect, "reason": reason, "why": why})

SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1.5.5.25 12.2.3.4 0 12.5 2.5.5.5"/>'
       '<polyline points="1.2.3.4 5.6.7.8"/></svg>')
ht("pass-page", "valid page: inline SVG (xmlns, numeric path data), public commit link, <main>, the word other", "pass", None,
   body=SVG + '<a href="https://github.com/example-owner/sdtm-pedia/commit/4be0d71">4be0d71</a><p>other projects</p>')
ht("block-html-google-font", "S12: external font", "block", "external URL", head='<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">')
ht("block-html-cdn-script", "S12: CDN script", "block", "external URL", head='<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0"></script>')
ht("block-html-css-import", "S12: CSS @import", "block", "external URL", head='<style>@import url("https://fonts.example.net/a.css");</style>')
ht("block-html-protocol-relative", "S12: protocol-relative font url()", "block", "protocol-relative", head='<style>@font-face{font-family:x;src:url(//fonts.example.net/x.woff2)}</style>')
ht("block-html-protocol-relative-img", "S12: protocol-relative image", "block", "protocol-relative", body='<img src="//img.example.net/a.png" alt="">')
ht("block-html-image", "S12: external image", "block", "external URL", body='<img src="https://img.example.net/a.png" alt="">')
ht("block-html-no-data", "HTML without embedded window.GB", "block", "no embedded window.GB", data=False)
ht("block-html-comment-name", "rule 6: private name in an HTML comment, other spelling", "block", "private name", body="<!-- todo: Falcon.Ledger link -->")
ht("block-html-js-comment-name", "rule 6: private name in a JS comment", "block", "private name", body="<script>// from orchid_batch\nvar a=1;</script>")
ht("block-html-u-escape", "rule 6: \\u-escaped private name in JS", "block", "private name", body='<script>var s="\\u006frchid-b\\u0061tch";</script>')
ht("block-html-entity", "rule 6: entity-encoded private name", "block", "private name", body="<p>&#111;rchid-b&#x61;tch</p>")
ht("block-html-percent", "rule 6: %-encoded private name", "block", "private name", body='<a href="#%6Frchid%2Dbatch">x</a>')
ht("block-html-cjk-escaped", "rule 6: CJK private name hidden as \\u escapes", "block", "private name", body='<script>var t="\\u9752\\u9e1f\\u8ba1\\u5212";</script>')
ht("block-html-email", "pattern: e-mail anywhere", "block", "email", body="<p>contact: someone@example.com</p>")
ht("block-html-ip", "pattern: tailnet IP anywhere", "block", "ipv4", body="<p>hub at 100.101.102.103</p>")
ht("block-html-ip-sentence-end", "pattern: IP ending a sentence", "block", "ipv4", body="<p>hub at 100.101.102.103.</p>")
ht("block-html-script-d-ip", "SVG exemption must not cover a script variable named d", "block", "ipv4", body='<script>var d="100.101.102.103";</script>')
ht("block-html-data-d-email", "SVG exemption must not cover data-d attributes", "block", "email", body='<i data-d="someone@example.com"></i>')
ht("block-html-gb-payload", "rule 4 inside the embedded payload", "block", "private commit keeps hash",
   data=(lambda o: (o["activity"][1].__setitem__("hash", "0a1b2c3"), o)[1])(copy.deepcopy(BASE)))
ht("block-html-fetch", "S12: runtime fetch of an external resource", "block", "external URL", body='<script>fetch("https://api.example.net/x")</script>')

(OUT / "cases.json").write_text(json.dumps(cases, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print(len(cases), "cases")
