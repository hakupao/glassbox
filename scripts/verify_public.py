#!/usr/bin/env python3
"""Publish gate: refuse a public glassbox snapshot that breaks CONTRACT §3.

Checks every file given (the public page JSON and the final HTML):

- structure (rules 1, 3): no key outside schema/public_fields.json; every value has its declared
  type; placeholders are exactly {"masked": true} (or the merged {"masked": true, "group":
  "private"} in today.byProject); titles carry no ticket id, e-mail, IP, path, URL or secret.
  HTML must embed its data as `window.GB = {...}` and that payload is checked the same way.
- cross-field (rules 4, 7): private commits have null branch / hash / url / machine, `t` on the
  hour and a masked repo; Gitea commits are never public; private byProject rows are the merged
  row; hidden blocks are [].
- name list (rule 6): terms from .local/redact_terms.local.json and the runtime private names
  (the exporter's gate context) must not occur anywhere. Normalised length >= 5: substring match
  on normalised text (case, - _ . and spaces ignored); shorter: word boundary on the raw text;
  `"match": {term: "substring"|"word"}` in the terms file overrides. Text is also checked after
  undoing HTML entities, \\uXXXX escapes and %-encoding.
- patterns: e-mails, IPv4/IPv6, absolute paths, secrets.
- other published files (.js .css .svg .txt .webmanifest) get the text checks only; any other
  file type is rejected, so nothing is published unchecked.
- resources: no external fonts / CDN / any absolute or protocol-relative URL, except commit URLs
  of public repos and XML namespace URIs.

    python3 scripts/verify_public.py FILE... --context .cache/gate-context.json
        [--terms .local/redact_terms.local.json] [--config .local/public.local.toml]
    (--no-context checks without runtime names, e.g. for the fabricated examples)

Exit status: 0 clean, 1 rejected (reasons listed, private words shown masked), 2 setup error.
This file shares no code with hub/export.py on purpose: one bug must not pass both.
"""
import argparse
import html
import json
import re
import sys
import tomllib
import urllib.parse
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIELDS = json.loads((ROOT / "schema" / "public_fields.json").read_text(encoding="utf-8"))["paths"]
MODELS = set(json.loads((ROOT / "probe" / "pricing.json").read_text(encoding="utf-8"))["models"])
MASK = {"masked": True}
MASK_PRIVATE = {"masked": True, "group": "private"}
GROUP_FIELD = "today.byProject[].project"

PATTERNS = {
    "email": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}"),
    "ipv4": re.compile(r"(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?!\w|\.\d)"),
    "ipv6": re.compile(r"(?i)(?<![\w:])(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}(?![\w:])"
                       r"|(?<![\w:])(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?(?![\w:])"),
    "path": re.compile(r"(?:/Users/|/home/|/Volumes/|/root/|/private/|/mnt/|/srv/|/var/folders/"
                       r"|(?<![\w~])~/|[A-Za-z]:\\(?:Users|Documents and Settings)\\|\\\\[A-Za-z0-9.-]+\\)"),
    "secret": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"
                         r"|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}"
                         r"|sk-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})"
                         r"|(?i:\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*[\"']?[^\s\"'<>{}]{4,})"),
}
TITLE_EXTRA = {                  # keys differ from PATTERNS: both sets apply to titles
    "ticket": re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b"),
    "url": re.compile(r"\b[A-Za-z][A-Za-z0-9+.-]*://"),
    "rooted path": re.compile(r"(?<![\w.])(?:~|\.{1,2})?/[\w.-]+/[\w.-]+"),
}
ABS_URL = re.compile(r"\b[A-Za-z][A-Za-z0-9+.-]*://[^\s\"'<>()\\]*")
REL_URL = re.compile(r"(?i)(?:\b(?:src|href|srcset|action|data|poster|xlink:href)\s*=\s*[\"']?\s*"
                     r"|url\(\s*[\"']?\s*|@import\s+[\"']?\s*|\bimport\s*\(\s*[\"']|\bfetch\s*\(\s*[\"'])//")
XMLNS = re.compile(r"http://www\.w3\.org/(?:2000/svg|1999/xhtml|1999/xlink|XML/1998/namespace)")
# Inside SVG shape tags only, number-only geometry ("M1.5.5.25 ...") is not an IP address.
SVG_TAG = re.compile(r"(?i)<(?:svg|path|polyline|polygon|g|use|rect|circle|ellipse|line)\b[^>]*>")
SVG_GEOMETRY = re.compile(r"(?i)(?<![\w-])(?:d|points|viewBox|transform)\s*=\s*\"[-0-9\s.,+eEMmLlHhVvCcSsQqTtAaZz()]*\"")
PREFIX_ONLY = re.compile(r"\*{6}|(?:feat|fix|docs|style|refactor|perf|tests?|build|ci|chore|revert|wip|merge"
                         r"|release|deps|init):")
GB_MARK = re.compile(r"window\.GB\s*=\s*")
TEXT_ONLY = {".js", ".mjs", ".css", ".svg", ".txt", ".webmanifest"}


class SetupError(Exception):
    pass


def norm(s):
    return re.sub(r"[-_.\s]", "", s).casefold()


def hide(s):
    """Show a private word without revealing it."""
    s = str(s)
    return (s[:1] + "*" * (len(s) - 1)) if len(s) > 1 else "*"


def generic(path):
    return re.sub(r"\[\d+\]", "[]", path)


CONTAINERS = set()
for _p in FIELDS:
    _parts = re.split(r"(?=\.)|(?=\[\])", _p)
    for _i in range(1, len(_parts)):
        CONTAINERS.add("".join(_parts[:_i]).lstrip("."))


def vocabulary():
    words = {"other", "masked", "group", "private", "public"}
    for path, typ in FIELDS.items():
        words.update(k for k in re.split(r"[.\[\]]+", path) if k)
        kind, _, arg = typ.rstrip("?").partition(":")
        if kind in ("enum", "const"):
            words.update(arg.split("|"))
            words.update(w for v in arg.split("|") for w in re.split(r"[^A-Za-z0-9-]+", v) if w)
    return {norm(w) for w in words}


class Gate:
    def __init__(self, terms, context, config):
        """terms: parsed redact-terms JSON; context: exporter gate context or None; config: parsed TOML."""
        allow_words = {a.casefold() for a in terms.get("allow", [])}
        self.modes = {k.casefold(): v for k, v in terms.get("match", {}).items()}
        bad = {v for v in self.modes.values() if v not in ("substring", "word")}
        if bad:
            raise SetupError(f"terms file: unknown match mode(s) {sorted(bad)}")
        self.allow = {k: set(v) for k, v in config.get("allow", {}).items()}
        ctx = context or {}
        self.private_projects = set(config.get("privateProjects", []))
        self.hidden = set(config.get("hidden", []))
        self.private_titles = config.get("privateTitles", "prefix-only")      # default: owner's decision 2026-11-17
        if self.private_titles not in ("prefix-only", "redacted"):
            raise SetupError("config privateTitles must be \"prefix-only\" or \"redacted\"")
        self.public_repos = (set(ctx.get("publicRepos", [])) | self.allow.get("activity[].repo", set())) \
            - self.private_projects
        for f in ("activity[].repo", GROUP_FIELD):
            self.allow.setdefault(f, set()).update(self.public_repos)
        self.allow.setdefault("activity[].branch", set()).update(ctx.get("publicBranches", []))
        self.codes = set(config.get("codes", []))
        self.keywords = [k for k in config.get("keywords", []) if k]
        owners = sorted(config.get("githubOwners", []))
        owner = "|".join(map(re.escape, owners))
        repos = "|".join(map(re.escape, sorted(self.public_repos)))
        self.repo_url = re.compile(r"https://github\.com/(?:" + owner + r")/(?:" + repos + r")/commit/[0-9a-f]{7,40}") \
            if repos and owners else None                # no configured owner: no link is public
        vocab = vocabulary()
        allowed_values = set().union(*self.allow.values()) if self.allow else set()
        runtime = [n for n in ctx.get("privateNames", [])
                   if norm(n) and norm(n) not in vocab and n not in allowed_values
                   and not (re.fullmatch(r"[A-Z]", n) or n in self.codes)]     # codes are public by design
        words = [t for t in terms.get("terms", []) if t and t.casefold() not in allow_words]
        self.names = sorted(set(words) | set(runtime) | set(self.keywords) | self.private_projects,
                            key=len, reverse=True)
        self.word_re, self.long = self._compile(self.names)

    def _compile(self, names):
        word, long = [], set()
        for t in names:
            mode = self.modes.get(t.casefold()) or ("substring" if len(norm(t)) >= 5 else "word")
            (long.add(norm(t)) if mode == "substring" else word.append(t))
        rx = re.compile(r"(?<![A-Za-z0-9_])(?:" + "|".join(map(re.escape, word)) + r")(?![A-Za-z0-9_])", re.I) \
            if word else None
        return rx, long

    # --- text checks --------------------------------------------------------------------------

    def name_hits(self, text):
        hits = set()
        if self.word_re:
            hits.update(m.group(0) for m in self.word_re.finditer(text))
        flat = norm(text)
        hits.update(n for n in self.long if n in flat)
        return hits

    def check_text(self, text, where, is_html=False):
        bad = []
        variants = {"raw": text, "html-entities": html.unescape(text),
                    "\\u-escapes": re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)),
                                          text.replace("\\/", "/")),
                    "%-encoding": urllib.parse.unquote(text)}
        seen = set()
        for how, t in variants.items():
            if how != "raw" and t == text:
                continue
            for h in self.name_hits(t):
                if norm(h) not in seen:
                    seen.add(norm(h))
                    bad.append(f"{where}: private name {hide(h)} ({how})")
            no_svg = SVG_TAG.sub(lambda m: SVG_GEOMETRY.sub('d=""', m.group(0)), t) if is_html else t
            for kind, rx in PATTERNS.items():
                for m in rx.finditer(no_svg if kind == "ipv4" else t):
                    if (kind, m.group(0)) not in seen:
                        seen.add((kind, m.group(0)))
                        bad.append(f"{where}: {kind} {hide(m.group(0))} ({how})")
            for m in ABS_URL.finditer(t):
                u = m.group(0).rstrip(".,;")
                if not (XMLNS.fullmatch(u) or (self.repo_url and self.repo_url.fullmatch(u))) and ("url", u) not in seen:
                    seen.add(("url", u))
                    bad.append(f"{where}: external URL {hide(u)} ({how})")
            for m in REL_URL.finditer(t):
                if ("rel", m.start()) not in seen:
                    seen.add(("rel", m.start()))
                    bad.append(f"{where}: protocol-relative external resource ({how})")
        return bad

    # --- structure ----------------------------------------------------------------------------

    def type_ok(self, v, typ, g):
        if typ.endswith("?"):
            if v is None:
                return True
            typ = typ[:-1]
        kind, _, arg = typ.partition(":")
        if kind == "number":
            return isinstance(v, (int, float)) and not isinstance(v, bool)
        if kind == "bool":
            return isinstance(v, bool)
        if kind == "null":
            return v is None
        if kind == "text":
            return v == MASK or (g == GROUP_FIELD and v == MASK_PRIVATE) or (
                isinstance(v, str) and v in self.allow.get(g, ()))
        if not isinstance(v, str):
            return False
        if kind == "iso":
            try:
                datetime.fromisoformat(v)
            except ValueError:
                return False
            return bool(re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)", v))
        if kind == "date":
            try:
                return bool(re.fullmatch(r"\d{4}-\d\d-\d\d", v)) and bool(datetime.strptime(v, "%Y-%m-%d"))
            except ValueError:
                return False
        if kind == "title":
            return not self.title_problems(v)
        return {
            "hash": lambda: bool(re.fullmatch(r"[0-9a-f]{7,40}", v)),
            "semver": lambda: bool(re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?", v)),
            "enum": lambda: v in arg.split("|"),
            "const": lambda: v == arg,
            "code": lambda: bool(re.fullmatch(r"[A-Z]", v)) or v in self.codes,
            "model": lambda: v in MODELS or v == "other",
            "url": lambda: arg == "public-repo" and bool(self.repo_url and self.repo_url.fullmatch(v)),
        }[kind]()

    def title_problems(self, v):
        out = [k for k, rx in {**PATTERNS, **TITLE_EXTRA}.items() if rx.search(v)]
        if self.name_hits(v):
            out.append("private name")
        return out

    def check_structure(self, node, path, bad):
        g = generic(path)
        if g in FIELDS:
            typ = FIELDS[g]
            if isinstance(node, (dict, list)) and not (typ.rstrip("?") == "text" and isinstance(node, dict)):
                bad.append(f"{path}: a {type(node).__name__} where {typ} is expected")
            elif not self.type_ok(node, typ, g):
                why = ""
                if typ.rstrip("?") == "title" and isinstance(node, str):
                    why = " — contains " + ", ".join(self.title_problems(node))
                elif isinstance(node, dict):
                    why = " — placeholder must be exactly {\"masked\": true}" + (
                        " or the merged private row" if g == GROUP_FIELD else "")
                bad.append(f"{path}: value ({type(node).__name__}, {hide(node) if isinstance(node, str) else ''}) "
                           f"is not {typ}{why}")
            return
        if g + "[]" in CONTAINERS or g + "[]" in FIELDS:
            if not isinstance(node, list):
                bad.append(f"{path}: must be a list")
                return
            for i, v in enumerate(node):
                self.check_structure(v, f"{path}[{i}]", bad)
            return
        if not path or g in CONTAINERS:
            if not isinstance(node, dict):
                bad.append(f"{path or '(root)'}: must be an object")
                return
            for k, v in node.items():
                if not isinstance(k, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9-]*", k):
                    bad.append(f"{path or '(root)'}: key {hide(k)} not in public_fields.json")
                    continue
                self.check_structure(v, f"{path}.{k}" if path else k, bad)
            return
        head, _, key = path.rpartition(".")          # an unknown key may itself be a private word
        bad.append(f"{head + '.' if head else ''}{hide(key)}: field not in public_fields.json")

    def check_page(self, page, where):
        bad = []
        if not isinstance(page, dict):
            return [f"{where}: page data is not an object"]
        for k, v in (("schema", "glassbox.page/1"), ("view", "public")):
            if page.get(k) != v:
                bad.append(f"{where}: {k} must be {v!r}")
        s = []
        self.check_structure(page, "", s)
        bad += [f"{where}: {x}" for x in s]
        acts = page.get("activity") if isinstance(page.get("activity"), list) else []
        for i, a in enumerate(acts):
            if not isinstance(a, dict):
                continue
            p = f"{where}: activity[{i}]"
            if a.get("source") == "gitea" and a.get("public") is not False:
                bad.append(f"{p}: gitea commits are never public")
            if a.get("public") is not True:
                if a.get("public") is not False:
                    bad.append(f"{p}: public must be true or false")
                for k in ("branch", "hash", "url", "machine"):
                    if a.get(k) is not None:
                        bad.append(f"{p}: private commit keeps {k}")
                if a.get("repo") != MASK:
                    bad.append(f"{p}: private commit repo must be masked")
                if self.private_titles == "prefix-only" and not (
                        isinstance(a.get("title"), str) and PREFIX_ONLY.fullmatch(a["title"])):
                    bad.append(f"{p}: private commit title must be only a prefix (privateTitles = prefix-only)")
                t = a.get("t")
                try:
                    dt = datetime.fromisoformat(t)
                    if (dt.minute, dt.second, dt.microsecond) != (0, 0, 0):
                        bad.append(f"{p}: private commit t is not on the hour")
                except (TypeError, ValueError):
                    bad.append(f"{p}: private commit t is not a time")
            else:
                if a.get("repo") == MASK:
                    bad.append(f"{p}: public commit with a masked repo")
                if a.get("source") == "local" and a.get("branch") is not None:
                    bad.append(f"{p}: local commit keeps branch")
        today = page.get("today") if isinstance(page.get("today"), dict) else {}
        rows = today.get("byProject") if isinstance(today.get("byProject"), list) else []
        for i, r in enumerate(rows):
            if isinstance(r, dict) and r.get("public") is not True and r.get("project") != MASK_PRIVATE:
                bad.append(f"{where}: today.byProject[{i}]: private usage must be the merged private row")
            if isinstance(r, dict) and r.get("project") == MASK_PRIVATE and r.get("public") is not False:
                bad.append(f"{where}: today.byProject[{i}]: merged private row must have public false")
        if sum(1 for r in rows if isinstance(r, dict) and r.get("project") == MASK_PRIVATE) > 1:
            bad.append(f"{where}: today.byProject: more than one merged private row")
        hidden = page.get("hidden") if isinstance(page.get("hidden"), list) else []
        for h in sorted(self.hidden - set(h for h in hidden if isinstance(h, str))):
            bad.append(f"{where}: config hides {h} but the page does not")
        for h in (h for h in hidden if isinstance(h, str)):
            block = today.get("byProject") if h == "byProject" else page.get(h)
            if block not in ([], None):
                bad.append(f"{where}: hidden block {h} is not []")
        return bad

    # --- files --------------------------------------------------------------------------------

    def check_file(self, path):
        p = Path(path)
        try:
            text = p.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as e:
            return [f"{p.name}: unreadable ({e.__class__.__name__})"]
        suffix = p.suffix.lower()
        is_html = suffix in (".html", ".htm")
        bad = self.check_text(text, p.name, is_html or suffix == ".svg")
        if suffix in TEXT_ONLY:                 # assets published next to the page: text checks only
            return bad
        if suffix not in (".json", ".html", ".htm"):
            return bad + [f"{p.name}: unknown file type {suffix or '(none)'}; the gate checks .html .json {' '.join(sorted(TEXT_ONLY))}"]
        if is_html:
            m = GB_MARK.search(text)
            if not m:
                return bad + [f"{p.name}: no embedded window.GB data"]
            try:
                page, _ = json.JSONDecoder().raw_decode(text, m.end())
            except ValueError:
                return bad + [f"{p.name}: window.GB is not valid JSON"]
            if len(GB_MARK.findall(text)) > 1:
                bad.append(f"{p.name}: more than one window.GB assignment")
        else:
            try:
                page = json.loads(text)
            except ValueError:
                return bad + [f"{p.name}: not valid JSON"]
        bad += self.check_page(page, p.name)
        values = []
        _strings(page, values)
        tag = p.name + " (decoded values)"
        known = {b.removeprefix(p.name) for b in bad}
        bad += [b for b in self.check_text("\n".join(values), tag) if b.removeprefix(tag) not in known]
        return bad


def _strings(node, out):
    if isinstance(node, dict):
        for k, v in node.items():
            out.append(str(k))
            _strings(v, out)
    elif isinstance(node, list):
        for v in node:
            _strings(v, out)
    elif isinstance(node, str):
        out.append(node)


def load_json(path, what):
    try:
        return json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise SetupError(f"{what} {Path(path).name}: {e.__class__.__name__}") from None


def load_toml(path):
    p = Path(path).expanduser()
    if not p.exists():
        return {}
    try:
        return tomllib.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise SetupError(f"config {p.name}: {e.__class__.__name__}") from None


def main(argv=None):
    ap = argparse.ArgumentParser(prog="verify_public")
    ap.add_argument("files", nargs="+")
    ap.add_argument("--terms", default=str(ROOT / ".local" / "redact_terms.local.json"))
    ap.add_argument("--config", default=str(ROOT / ".local" / "public.local.toml"))
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--context", help="gate context written by hub.export (private names, public repos)")
    g.add_argument("--no-context", action="store_true", help="check without runtime private names")
    a = ap.parse_args(argv)
    try:
        terms = load_json(a.terms, "terms file")
        ctx = None if a.no_context else load_json(a.context, "gate context")
        if ctx is not None and not isinstance(ctx.get("privateNames"), list):
            raise SetupError("gate context has no privateNames list")
        gate = Gate(terms, ctx, load_toml(a.config))
    except SetupError as e:
        print(f"setup error: {e}", file=sys.stderr)
        return 2
    total = 0
    for f in a.files:
        for b in gate.check_file(f):
            total += 1
            print(b)
    print(f"\nchecked {len(a.files)} file(s): {'REJECTED, ' + str(total) + ' problem(s)' if total else 'clean'}")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
