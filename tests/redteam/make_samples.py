"""Regenerate the red-team samples and cases.json (fabricated data only).

    python3 tests/redteam/make_samples.py

Values the repo's privacy scan would flag (home paths, GitHub tokens) are written as
{{PLACEHOLDERS}} and assembled by tests/test_redteam.py at load time.
"""
import copy
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
CSP = ("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; "
       "font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'")
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
js("block-unknown-nested-key", "rule 1: reviewer on a commit (author is public since S17 R09)", "block", "field not in public_fields.json", lambda o: act(o).__setitem__("reviewer", "someone"))
js("pass-hourly", "today.hourly is public since 2026-11-27: hour, requests, cost", "pass", None, lambda o: o["today"].__setitem__("hourly", [{"hour": 9, "requests": 3, "costUsd": 0.1}]))
js("block-hourly-extra-key", "an hour row carries only hour, requests and cost", "block", "field not in public_fields.json", lambda o: o["today"].__setitem__("hourly", [{"hour": 9, "requests": 3, "costUsd": 0.1, "project": {"masked": True}}]))
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
js("block-local-public-branch", "local commit of a public repo keeps its branch (may be a private fork)", "block", "local commit keeps branch",
   lambda o: o["activity"].append(dict(copy.deepcopy(o["activity"][0]), source="local", url=None)))
for key, put in (("code", lambda o: o.__setitem__("code", {})),
                 ("warnings", lambda o: o.__setitem__("warnings", ["probe A is late"]))):
    js(f"block-provisional-{key}", f"provisional field {key} from lane A is not public", "block", "field not in public_fields.json", put)
# public since 2026-11-27 (CONTRACT 2.2): day rows by machine code and by project, and a few plain numbers
day = lambda **kw: lambda o: o.__setitem__("usageDays", [dict({"date": "2026-11-17"}, **kw)])
js("pass-public-numbers", "disk history, the official GitHub total and a machine's usage today are plain numbers", "pass", None, lambda o: o.update(
   contributions={"total": 0, "days": [], "githubOfficialTotal": 9},
   machines=[{"id": "A", "label": {"masked": True}, "online": True,
              "history": [{"t": "2026-11-17T10:00:00+09:00", "cpuPct": 1, "memPct": 2, "diskPct": 3}],
              "todayByAgent": [{"agent": "codex", "requests": 7, "unpricedRequests": 0, "costUsd": 1.5, "sessions": 2}]}]))
js("pass-usage-day-rows", "a day's machine rows carry codes; its project rows are public repos and one merged private row", "pass", None, day(
   byMachine=[{"machine": "A", "requests": 1, "sessions": 1, "unpricedRequests": 0, "costUsd": 0.1, "tokens": {"input": 5, "output": 4, "cacheRead": 3, "cacheWrite": 2, "reasoning": 1}}],
   byProject=[{"project": "sdtm-pedia", "public": True, "requests": 1, "sessions": 1, "unpricedRequests": 0, "costUsd": 0.1},
              {"project": {"masked": True, "group": "private"}, "public": False, "requests": 2, "sessions": 1, "unpricedRequests": 0, "costUsd": 0.2}]))
js("block-usage-day-machine", "a day's machine row names a machine that has no public code", "block", "is not code", day(byMachine=[{"machine": "warehouse-box", "requests": 1, "costUsd": 0.1}]))
js("block-usage-day-machine-key", "a day's machine row carries only the whitelisted keys", "block", "field not in public_fields.json", day(byMachine=[{"machine": "A", "requests": 1, "costUsd": 0.1, "host": "x"}]))
js("block-usage-day-project-unmerged", "a day's private project row is not the merged row", "block", "merged private row", day(byProject=[{"project": {"masked": True}, "public": False, "requests": 1, "costUsd": 0.1}]))
js("block-usage-day-project-masked-public", "masked rows marked public would publish each private project's cost on its own", "block", "a public row must show its name", day(byProject=[{"project": {"masked": True}, "public": True, "requests": 1, "costUsd": 0.1}] * 2))
js("block-byproject-masked-public", "the same for today", "block", "a public row must show its name", lambda o: o["today"]["byProject"].append({"project": {"masked": True}, "public": True, "requests": 1, "costUsd": 0.1}))
js("block-usage-day-project-twice", "a day has two merged private rows", "block", "more than one merged private row", day(byProject=[{"project": {"masked": True, "group": "private"}, "public": False, "requests": 1, "costUsd": 0.1}] * 2))
js("block-usage-day-project-name", "a day's project row shows a name that is not a public repo", "block", "is not text", day(byProject=[{"project": "warehouse-sync", "public": True, "requests": 1, "costUsd": 0.1}]))
js("block-usage-day-project-key", "a day's project row carries only the whitelisted keys", "block", "field not in public_fields.json", day(byProject=[{"project": "sdtm-pedia", "public": True, "requests": 1, "costUsd": 0.1, "path": "x"}]))
js("block-hidden-byproject-days", "rule 7: hidden byProject, but a day still has project rows", "block", "hidden block byProject", lambda o: (
   o["today"].__setitem__("byProject", []), o["hidden"].append("byProject"),
   o.__setitem__("usageDays", [{"date": "2026-11-17", "byProject": [{"project": "sdtm-pedia", "public": True, "requests": 1, "costUsd": 0.1}]}])))
js("block-today-by-agent-key", "a machine's usage today carries only the whitelisted keys", "block", "field not in public_fields.json", lambda o: o.__setitem__("machines", [
   {"id": "A", "label": {"masked": True}, "online": True, "todayByAgent": [{"agent": "codex", "requests": 7, "costUsd": 1.5, "project": {"masked": True}}]}]))
js("pass-usage-days", "a day's totals with its agent and model rows are public (2026-11-27)", "pass", None, lambda o: o.__setitem__("usageDays", [{
   "date": "2026-11-17", "requests": 3, "sessions": 2, "unpricedRequests": 1, "cacheHitRate": 0.5, "costUsd": 0.4,
   "tokens": {"input": 5, "output": 4, "cacheRead": 3, "cacheWrite": 2, "reasoning": 1},
   "byAgent": [{"agent": "codex", "requests": 3, "sessions": 2, "costUsd": 0.4, "tokens": {"input": 5, "output": 4, "cacheRead": 3, "cacheWrite": 2, "reasoning": 1}}],
   "byModel": [{"model": "other", "agent": "codex", "requests": 3, "unpricedRequests": 1, "costUsd": None, "tokens": {"input": 5, "output": 4, "cacheRead": 3, "cacheWrite": 2, "reasoning": 1}}]}]))
js("block-usage-day-model", "a day's model id outside the price table", "block", "is not model", lambda o: o.__setitem__("usageDays", [{
   "date": "2026-11-17", "byModel": [{"model": "wren-internal-9", "agent": "codex", "requests": 1, "unpricedRequests": 1, "costUsd": None}]}]))
js("pass-nullable-fields", "nulls lane A can emit on whitelisted nullable paths", "pass", None, lambda o: o.update(
   machines=[{"id": "A", "label": {"masked": True}, "role": None, "os": None, "online": False, "lastSeen": None}],
   runtimes=[{"machine": "A", "agent": "codex", "version": None, "processes": 0, "activeSessions": 0, "stale": True}],
   services=[{"name": {"masked": True}, "kind": "monitor", "machine": None, "status": "unknown", "uptimePct24h": None,
              "cpuPct": None, "memBytes": None}]))
MACHINE = {"id": "A", "label": {"masked": True}, "role": "dev", "os": "macos", "icon": "laptop", "color": "blue",
           "online": True, "lastSeen": None}
js("pass-machine-look", "machine icon and colour from the closed lists (or null)", "pass", None, lambda o: o.update(
   machines=[dict(MACHINE), dict(MACHINE, id="V", role="deploy", os="linux", icon=None, color=None)]))
js("block-machine-icon", "machine icon off the list (could carry text)", "block", "is not enum",
   lambda o: o.update(machines=[dict(MACHINE, icon="studio-dev")]))
js("block-machine-color", "machine colour off the list (raw CSS)", "block", "is not enum",
   lambda o: o.update(machines=[dict(MACHINE, color="#ff0000")]))
js("block-machine-icon-type", "machine icon that is not a string (number, object)", "block", "is not enum",
   lambda o: o.update(machines=[dict(MACHINE, icon=3), dict(MACHINE, id="V", icon={"name": "laptop"})]))
js("block-machine-icon-case", "machine icon in another case: the list is exact", "block", "is not enum",
   lambda o: o.update(machines=[dict(MACHINE, icon="Laptop")]))
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

# --- S17 R09: commit author, file count and file paths (R10: listed branch fragments) ---------------
FILES = [{"s": "M", "p": "hub/export.py"}, {"s": "A", "p": "docs/日本語 notes (v2).md"}, {"s": "R", "p": "web/pages.js"}]
def files(lst, n=None, who=act):
    return lambda o: who(o).update(files=copy.deepcopy(lst), nFiles=len(lst) if n is None else n)
def path(p): return files([{"s": "M", "p": p}])
js("pass-files-author", "public pushed GitHub commit: configured author, paths, count; private commit keeps a count only; "
   "the author is also a listed branch fragment (branchFragments), so it is not a private name", "pass", None,
   lambda o: (files(FILES, 7)(o), act(o).__setitem__("author", "example-owner"), priv(o).__setitem__("nFiles", 2)))
js("pass-nfiles-zero", "merge commit: nFiles 0, no list; nulls on every new field", "pass", None,
   lambda o: (act(o).update(nFiles=0, author=None), priv(o).update(nFiles=None, author=None)))
js("block-files-private-name", "rule 6: a path carries a private repo name", "block", "private name", path("src/falcon_ledger/rules.py"))
js("block-files-private-camel", "rule 6: a path carries a private name in camelCase", "block", "private name", path("lib/OrchidBatch.ts"))
js("block-files-short-term", "rule 6: a path carries a short private word as a directory", "block", "private name", path("x/owl/config.py"))
js("block-files-private-hash", "rule 6: a path carries a private commit id", "block", "private name", path("notes/e1f2a3b.md"))
js("block-files-branch-fragment", "rule 6: a path carries an unlisted private branch fragment", "block", "private name", path("docs/marmotte.md"))
js("block-files-keyword", "rule 5/6: a path carries a blocked keyword", "block", "private name", path("plans/Project_Nightjar.md"))
js("block-files-email", "pattern: a path that reads as an e-mail", "block", "email", path("docs/team@example.com"))
js("block-files-ip", "pattern: a path that reads as an IP address", "block", "ipv4", path("releases/203.0.113.7/notes.md"))
# Review R09 M1: no single path holds the name, the serialized stream does ("p" + "ixel-forge", "field-note" + next "s").
js("block-files-join-key", "rule 6: a path joined to the key before it spells a private project", "block", "private name",
   path("ixel-forge/readme.md"))
js("block-files-join-next", "rule 6: a path joined to the next file entry spells a private project", "block", "private name",
   files([{"s": "M", "p": "docs/field-note"}, {"s": "M", "p": "b.md"}]))
# Backlog A5: a title joined to the next key ("docs: note" + "branch" spells the private project note-branch).
js("block-title-join-key", "rule 6: a title joined to the next key spells a private project", "block", "private name", title("docs: note"))
# Backlog A5: "<" is escaped in index.html, so "<b12" reads "u003cb12" there: the private commit id 003cb12.
js("pass-title-lt-json", "a title with '<': as page JSON it spells no private commit id", "pass", None, title("fix: render <b12 tag"))
# Backlog A6 (1): a branch joined to the next key ("feat/wild" + "hash" spells the private project wild-hash).
js("block-branch-join-key", "rule 6: a public branch joined to the next key spells a private project", "block", "private name",
   lambda o: act(o).__setitem__("branch", "feat/wild"))
# Backlog A6 (2): literal escapes the gate decodes into a private word (owl) or a private project joined to "branch".
for name, t in (("u", "docs: \\u006fwl notes"), ("x", "docs: \\x6fwl notes"), ("concat", "docs: 'o'+'wl' notes"),
                ("u-join", "docs: n\\u006fte")):
    js(f"block-title-escaped-{name}", f"rule 6: a title the gate decodes ({name}) spells a private name", "block", "private name", title(t))
# Backlog A8: JSON writes a title's "\r\n" as "\\r\\n", a \\host\ path to the gate; '"//host' reads as protocol-relative.
js("block-title-backslash-json", "pattern: literal backslash sequences in a title read as a UNC path once serialised", "block", "path",
   title("fix: normalise \\r\\n line endings"))
js("block-branch-backslash-json", "pattern: a branch with backslashes reads as a UNC path once serialised", "block", "path",
   lambda o: act(o).__setitem__("branch", "feat\\b\\c"))
js("block-title-proto-rel", "pattern: a quote then //host in a title reads as a protocol-relative URL", "block", "protocol-relative",
   title('docs: load "//cdn.example.com here'))
# Backlog A6 (3): a prefix joined to the next key ("perf:" + "branch" spells the private project perf-branch).
js("block-title-prefix-join-key", "rule 6: a bare prefix joined to the next key spells a private project", "block", "private name",
   title("perf:"))
js("block-files-on-private", "files on a private commit", "block", "file paths on a commit that is not public", files(FILES, who=priv))
js("block-files-unpushed", "files on an unpushed commit of a public repo", "block", "file paths on a commit that is not public",
   lambda o: (files(FILES)(o), act(o).__setitem__("pushed", False)))
js("block-files-local", "files on a local commit of a public repo (pushed alone is not enough: any remote)", "block",
   "file paths on a commit that is not public", lambda o: (files(FILES)(o), act(o).update(source="local", branch=None, url=None)))
js("block-files-gitea", "files on a Gitea commit", "block", "file paths on a commit that is not public",
   lambda o: (files(FILES)(o), act(o).update(source="gitea")))
js("block-files-too-many", "more than 50 paths", "block", "more than 50 files",
   files([{"s": "M", "p": f"src/f{i}.py"} for i in range(51)]))
js("block-files-nfiles-short", "nFiles smaller than the list", "block", "nFiles is missing or smaller", files(FILES, 2))
js("block-files-nfiles-missing", "list without nFiles", "block", "nFiles is missing or smaller",
   lambda o: (files(FILES)(o), act(o).__setitem__("nFiles", None)))
js("block-files-null", "files: null (the exporter drops the key instead)", "block", "must be a list",
   lambda o: act(o).update(files=None, nFiles=3))
js("block-nfiles-string", "rule 3: nFiles as a string", "block", "is not number", lambda o: act(o).__setitem__("nFiles", "3"))
js("block-nfiles-negative", "nFiles below zero", "block", "nFiles must be a whole count", lambda o: priv(o).__setitem__("nFiles", -1))
js("block-nfiles-fraction", "nFiles not whole", "block", "nFiles must be a whole count", lambda o: priv(o).__setitem__("nFiles", 2.5))
for name, bad in (("absolute", "/etc/hosts.txt"), ("dotdot", "docs/../../x.md"), ("dot", "./x.md"),
                  ("backslash", "docs\\x.md"), ("drive", "C:/x.md"), ("control", "docs/a\u0007b.md"),
                  ("zero-width", "docs/a\u200bb.md"), ("blank-segment", "docs/ /x.md"), ("empty-segment", "docs//x.md"),
                  ("long", "d/" * 150 + "x.md"), ("empty", "")):
    js(f"block-path-{name}", f"type path: {name}", "block", "is not path", path(bad))
js("block-files-status", "file status off the closed list", "block", "is not enum", files([{"s": "X", "p": "a.md"}]))
js("block-files-status-word", "GitHub's status word instead of the letter", "block", "is not enum", files([{"s": "modified", "p": "a.md"}]))
js("block-files-extra-key", "a file entry with a key outside the table", "block", "field not in public_fields.json",
   files([{"s": "M", "p": "a.md", "sha": "4be0d71"}]))
js("block-author-private", "rule 4: a private commit keeps the author", "block", "private commit keeps author",
   lambda o: priv(o).__setitem__("author", "example-owner"))
js("block-author-free-text", "author must be a configured login, not free text", "block", "is not author",
   lambda o: act(o).__setitem__("author", "someone-else"))
js("block-author-masked", "author is not a Text field: a placeholder is refused", "block", "where author? is expected",
   lambda o: act(o).__setitem__("author", {"masked": True}))

def page_js(o, esc=False):
    d = json.dumps(o, ensure_ascii=False)
    if esc:                                              # as hub/page.py html() inlines it
        d = d.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    return "window.GB = " + d + ";"
def ht(name, why, expect, reason, head="", body="", data=None, esc=False):
    o = copy.deepcopy(BASE) if data is None else data
    gb = "" if data is False else f"<script>{page_js(o, esc)}</script>"
    doc = f"<!doctype html>\n<html><head><meta http-equiv=\"Content-Security-Policy\" content=\"{CSP}\"><meta charset=\"utf-8\"><title>glassbox</title>{head}<style>body{{background:#111}}</style></head>\n<body><main>\n{body}\n</main>{gb}</body></html>\n"
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
ht("block-html-no-data", "HTML without embedded window.GB", "block", "needs exactly one <script>", data=False)
ht("block-html-script-src", "M2c: no external or local script files", "block", "<script src>", body='<script src="app.js"></script>')
ht("block-html-link", "M2c: no <link> except the exact favicon", "block", "<link>", head='<link rel="stylesheet" href="data:,">')
ht("block-html-link-two-favicons", "M2c: the favicon link at most once", "block", "<link>",
   head='<link rel="icon" href="data:,"><link rel="icon" href="data:,">')
ht("block-html-link-favicon-variant", "M2c: favicon link must match exactly", "block", "<link>",
   head='<link rel="icon" href="data:,x" type="image/png">')
HEAD_PREFIX = '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">'
for name, why, expect, reason, doc in [
    ("pass-html-head-lane-d", "lane D layout: lang, newlines, CSP first in head", "pass", None,
     '<!doctype html>\n<html lang="zh-CN">\n<head>\n' + HEAD_PREFIX + '\n<meta charset="utf-8">\n</head>'),
    ("block-html-head-comment", "a comment before the CSP", "block", "exact CSP",
     '<!doctype html><html><head><!-- x -->' + HEAD_PREFIX + '</head>'),
    ("block-html-head-text", "text before the CSP", "block", "exact CSP", '<!doctype html><html><head>x' + HEAD_PREFIX + '</head>'),
    ("block-html-head-attr", "an attribute other than lang on <html>", "block", "exact CSP",
     '<!doctype html><html lang="en" data-x="1"><head>' + HEAD_PREFIX + '</head>'),
    ("block-html-no-doctype", "no doctype", "block", "exact CSP", '<html><head>' + HEAD_PREFIX + '</head>'),
]:
    (S / f"{name}.html").write_text(doc + "<body><script>window.GB = " + json.dumps(BASE) + ";</script></body></html>\n",
                                    encoding="utf-8")
    cases.append({"file": f"{name}.html", "expect": expect, "reason": reason, "why": why})
ht("pass-html-favicon", "the one exact favicon link of the lane D bundle", "pass", None, head='<link rel="icon" href="data:,">')
ht("block-html-second-data", "M2d: a second data script", "block", "exactly one <script>", body="<script>window.GB = {};</script>")
ht("block-html-gb-write", "M2d: another script writes GB", "block", "writes GB", body="<script>GB.tailnet = [];</script>")
ht("block-html-gb-bracket", "M2d: window['GB'] in another script", "block", "writes GB", body="<script>window['GB'].x = 1;</script>")
ht("block-html-onload-gb", "M2d: an event handler writes GB", "block", "writes GB", body='<body onload="window.GB = {}">')
ht("block-html-gb-alias", "M2d: aliasing GB (const GB = ...) counts as a write", "block", "writes GB", body="<script>const GB = window.GB;</script>")
ht("pass-html-bytes-and-comments", "byte units, // comments naming window.GB, a .local property: no rule noise", "pass", None,
   body="<script>const U = ['B', 'KB', 'MB', 'GB']; // reads window.GB only\nfoo( // see window.GB docs\n); const x = cfg.local;</script>")
ht("block-html-meta-refresh", "M2b: a second http-equiv", "block", "http-equiv", head='<meta http-equiv="refresh" content="0">')
ht("block-html-attr-url", "M2: URL attribute that is not #, empty or data:", "block", "must be empty", body='<a href="page2.html">x</a>')
ht("block-html-css-url", "M2: CSS url() to a file", "block", "url()", head="<style>b{background:url(x.png)}</style>")
(S / "block-html-no-csp.html").write_text("<!doctype html><html><head><meta charset=\"utf-8\"></head><body><script>window.GB = "
    + json.dumps(BASE) + ";</script></body></html>\n", encoding="utf-8")
cases.append({"file": "block-html-no-csp.html", "expect": "block", "reason": "exact CSP", "why": "M2b: no CSP meta"})
(S / "block-html-csp-late.html").write_text("<!doctype html><html><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\""
    + CSP + "\"></head><body><script>window.GB = " + json.dumps(BASE) + ";</script></body></html>\n", encoding="utf-8")
cases.append({"file": "block-html-csp-late.html", "expect": "block", "reason": "exact CSP", "why": "M2b: CSP not first in head"})
(S / "block-html-csp-weak.html").write_text("<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src *\"></head><body><script>window.GB = "
    + json.dumps(BASE) + ";</script></body></html>\n", encoding="utf-8")
cases.append({"file": "block-html-csp-weak.html", "expect": "block", "reason": "exact CSP", "why": "M2b: a weaker CSP"})
(S / "block-json-duplicate-key.json").write_text(json.dumps(BASE)[:-1] + ', "view": "public"}\n', encoding="utf-8")
cases.append({"file": "block-json-duplicate-key.json", "expect": "block", "reason": "duplicate key", "why": "M2a: repeated key"})
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
ht("block-html-title-escaped", "rule 6: the bundler's \\u003c escape of '<b12' spells a private commit id", "block", "private name",
   data=(lambda o: (act(o).__setitem__("title", "fix: render <b12 tag"), o)[1])(copy.deepcopy(BASE)), esc=True)
ht("block-html-fetch", "S12: runtime fetch of an external resource", "block", "external URL", body='<script>fetch("https://api.example.net/x")</script>')

(OUT / "cases.json").write_text(json.dumps(cases, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print(len(cases), "cases")
