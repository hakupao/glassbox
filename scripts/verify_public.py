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
- visibility (review H1): public repos and private names are derived here from the private page
  (--private), not taken from the exporter. A name is public only if every occurrence is public
  and not Gitea; a name that is both allowlisted / shown and private is rejected.
- name list (rule 6): terms from .local/redact_terms.local.json and the derived private names
  must not occur anywhere. Normalised length >= 5: substring match
  on normalised text (case, - _ . and spaces ignored); shorter: word boundary on the raw text;
  `"match": {term: "substring"|"word"}` in the terms file overrides. Text is also checked after
  undoing HTML entities, \\uXXXX escapes and %-encoding.
- patterns: e-mails, IPv4/IPv6, absolute paths, secrets.
- single file (review M2): the publish directory holds index.html and optionally CNAME (one
  domain), nothing else. index.html starts with <!doctype html><html><head> and the exact CSP
  <meta> (see CSP below), has no <script src>, <link>, <base>, frames or forms, no URL attribute
  other than empty, #fragment, data: or a public commit link, no CSS url() / @import except data:,
  exactly one <script> holding only `window.GB = {...};`, and no other script writing GB.
  JSON is parsed with duplicate keys refused.
- resources: no external fonts / CDN / any absolute or protocol-relative URL, except commit URLs
  of public repos and XML namespace URIs.

    python3 scripts/verify_public.py FILE... --private PRIVATE.json
        [--terms .local/redact_terms.local.json] [--config .local/public.local.toml]
    (--no-private only for fabricated examples)

Exit status: 0 clean, 1 rejected (reasons listed, private words shown masked), 2 setup error.
This file shares no code with hub/export.py on purpose: one bug must not pass both.
"""
import argparse
import html
import json
import re
import sys
import tomllib
import unicodedata
import urllib.parse
from html.parser import HTMLParser
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
# Review M2: the public snapshot is ONE self-contained HTML file whose head starts with this CSP.
CSP = ("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; "
       "font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'")
HEAD_RX = re.compile(r"\A\ufeff?\s*<!doctype html>\s*<html(?:\s+lang=\"[A-Za-z-]+\")?\s*>\s*<head>\s*"
                     r"<meta http-equiv=\"Content-Security-Policy\" content=\"" + re.escape(CSP) + r"\"\s*/?>", re.I)
GB_SCRIPT = re.compile(r"\s*window\.GB\s*=\s*(.*?)\s*;?\s*", re.S)
GB_WRITE = re.compile(r"\bGB\w*\b(?:\s*(?:\.\s*[\w$]+|\[[^\]]*\]))*\s*(?:[-+*/%&|^]?=(?!=)|\+\+|--)|\bGB\w*\s*\["
                      r"|[\"'`]GB\w*[\"'`]")
PROTO_REL = re.compile(r"[\"'`(=]\s*[/\\]\s*[/\\]\s*[\w-]+(?:\.[\w-]+)+"             # '//host', '/\t/host', '\\host'
                       r"|\b[A-Za-z][\w+.-]*:\s*(?:\\|/\s+/|/\\)\s*[/\\]?\s*[\w-]+(?:\.[\w-]+)+")  # 'https:\\host'

DENY_TAGS = {"link", "base", "iframe", "frame", "frameset", "object", "embed", "applet", "portal", "form"}
URL_ATTRS = {"src", "srcset", "href", "action", "formaction", "poster", "background", "data", "ping", "xlink:href",
             "codebase", "cite", "longdesc", "manifest", "icon", "lowsrc", "dynsrc", "archive", "classid", "usemap"}
CSS_URL = re.compile(r"(?i)url\(\s*([\"']?)\s*(?!data:)[^)]*\)|@import")
CNAME_RX = re.compile(r"(?=.{1,253}\Z)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}")


class DuplicateKey(ValueError):
    pass


def strict_object(pairs):
    """object_pairs_hook: a repeated key could smuggle a second value past the checks (review M2a)."""
    out = {}
    for k, v in pairs:
        if k in out:
            raise DuplicateKey("duplicate key")
        out[k] = v
    return out


def strict_json(text):
    return json.loads(text, object_pairs_hook=strict_object)


class _Parse(HTMLParser):
    """Collects tags, attributes and script / style bodies the way a browser tokenises them."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tags, self.scripts, self.styles, self._in = [], [], [], None

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, attrs))
        if tag in ("script", "style"):
            self._in = (tag, attrs, [])

    def handle_startendtag(self, tag, attrs):
        self.tags.append((tag, attrs))

    def handle_data(self, data):
        if self._in:
            self._in[2].append(data)

    def handle_endtag(self, tag):
        if self._in and tag == self._in[0]:
            (self.scripts if tag == "script" else self.styles).append((self._in[1], "".join(self._in[2])))
            self._in = None


class SetupError(Exception):
    pass


# Cyrillic / Greek letters that look Latin (review M1), folded before any comparison.
LOOKALIKE = {ord(k): v for k, v in zip(
    "аеорсухіјѕԁвкмнтАВЕКМНОРСТХІЈЅαβεικνορτυχΑΒΕΖΗΙΚΜΝΟΡΤΥΧ",
    "aeopcyxijsdbkmhtABEKMHOPCTXIJSabeikvoptuxABEZHIKMNOPTYX")}


def clean(s):
    """NFKC, format characters (zero-width, soft hyphen, ...) removed, look-alikes folded."""
    s = unicodedata.normalize("NFKC", s)
    return "".join(ch for ch in s if unicodedata.category(ch) != "Cf").translate(LOOKALIKE)


def norm(s):
    return "".join(ch for ch in clean(s).casefold() if unicodedata.category(ch)[0] in "LN")


def words(s):
    """Word list for short terms: _ is a boundary, camelCase and letter/digit and script changes
    split words (review L2, owner's decision 2026-11-17)."""
    out, cur, prev = [], "", None
    for ch in clean(s):
        cat = unicodedata.category(ch)[0]
        if cat not in "LN":
            out.append(cur); cur, prev = "", None
            continue
        kind = "d" if cat == "N" else ("latin" if ch.isascii() else "other")
        if cur and (kind != prev or (ch.isupper() and cur[-1].islower())):
            out.append(cur); cur = ""
        cur += ch
        prev = kind
    out.append(cur)
    # "HTTPServer": an upper run followed by Capitalised word
    split = []
    for w in out:
        split.extend(x for x in re.split(r"(?<=[A-Z])(?=[A-Z][a-z])", w) if x)
    return [w.casefold() for w in split]


def decodings(text, limit=8):
    """Successive decodings of text: HTML entities, \\uXXXX, \\u{X}, \\xHH, CSS \\HH, %XX and JS string
    concatenation, repeated until nothing changes (review M1)."""
    out, t = [], text
    for _ in range(limit):
        n = html.unescape(t)
        n = re.sub(r"\\u\{([0-9a-fA-F]{1,6})\}", lambda m: _chr(m.group(1)), n)
        n = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: _chr(m.group(1)), n)
        n = re.sub(r"\\x([0-9a-fA-F]{2})", lambda m: _chr(m.group(1)), n)
        n = re.sub(r"\\([0-9a-fA-F]{1,6})\s?", lambda m: _chr(m.group(1)), n)
        n = n.replace("\\/", "/")
        n = urllib.parse.unquote(n)
        n = re.sub(r"([\"'`])\s*\+\s*([\"'`])", "", n)
        if n == t:
            break
        out.append(n)
        t = n
    return out


def _chr(h):
    try:
        return chr(int(h, 16))
    except (ValueError, OverflowError):
        return ""


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


def walk_items(node, path):
    """Dicts at `path` ("a.b[].c" style, list-valued at the end)."""
    nodes = [node]
    for part in path.split("."):
        many = part.endswith("[]")
        nodes = [n.get(part[:-2] if many else part) for n in nodes if isinstance(n, dict)]
        if many:
            nodes = [x for n in nodes if isinstance(n, list) for x in n]
    return [x for n in nodes if isinstance(n, list) for x in n if isinstance(x, dict)]


GENERIC_BRANCH_WORDS = {"main", "master", "dev", "develop", "development", "feature", "features", "feat", "fix",
                        "fixes", "bugfix", "hotfix", "release", "releases", "wip", "trunk", "stage", "staging",
                        "prod", "production", "test", "tests", "chore", "docs", "refactor", "update", "patch",
                        "draft", "temp", "backup", "experiment"}
SITES = [("activity", "repo"), ("today.byProject", "project"), ("code.commits", "repo"), ("code.repos", "repo"),
         ("usageDays[].byProject", "project")]
TEXT_PATHS = [p for p, t in FIELDS.items() if t.rstrip("?") == "text" and p != "activity[].branch"]


def derive(private, private_projects):
    """Visibility and private names, read from the PRIVATE page itself — not from the exporter.
    A name is public only when every occurrence is public:true and not Gitea (review H1)."""
    seen = {}
    for path, key in SITES:
        for e in walk_items(private, path):
            n = e.get(key)
            if isinstance(n, str) and norm(n):
                ok = e.get("public") is True and e.get("source") != "gitea" and "gitea" not in (e.get("sources") or [])
                seen.setdefault(norm(n), [set(), True])
                seen[norm(n)][0].add(n)
                seen[norm(n)][1] = seen[norm(n)][1] and ok
    for n in private_projects:
        seen.setdefault(norm(n), [set(), True])[0].add(n)
        seen[norm(n)][1] = False
    public = {s for spellings, ok in seen.values() if ok for s in spellings}
    names = {s for spellings, ok in seen.values() if not ok for s in spellings}
    for path in TEXT_PATHS:                      # every other Text value: private unless allowlisted
        head, _, key = path.rpartition(".")
        for e in walk_items(private, head.removesuffix("[]")) if head.endswith("[]") else [private.get(head) or {}]:
            v = e.get(key) if isinstance(e, dict) else None
            if isinstance(v, str) and norm(v) not in {norm(p) for p in public}:
                names.add(v)
    branches, hashes, frags = set(), set(), set()
    for path in ("activity", "code.commits"):
        for e in walk_items(private, path):
            if isinstance(e.get("repo"), str) and e["repo"] in public:
                if e.get("source") != "local" and isinstance(e.get("branch"), str):
                    branches.add(e["branch"])
            else:
                if isinstance(e.get("hash"), str):
                    hashes.add(e["hash"])
                if isinstance(e.get("branch"), str):     # review M3: telling parts of private branches
                    frags.update(f for f in re.split(r"[/\-_]+", e["branch"])
                                 if len(f) >= 4 and f.casefold() not in GENERIC_BRANCH_WORDS)
                if isinstance(e.get("url"), str):
                    host = re.sub(r"^\w+://([^/]+).*", r"\1", e["url"]).lower()
                    if host not in ("github.com", "www.github.com"):
                        hashes.add(host)
    return public, names | hashes | frags, branches, hashes | frags


class Gate:
    def __init__(self, terms, private, config):
        """terms: parsed redact-terms JSON; private: the private page/1 the snapshot was exported
        from (None only for fabricated examples); config: parsed TOML."""
        check_terms(terms)
        check_config(config)
        allow_words = {a.casefold() for a in terms.get("allow", [])}
        self.modes = {k.casefold(): v for k, v in terms.get("match", {}).items()}
        self.allow = {k: set(v) for k, v in config.get("allow", {}).items()}
        self.private_projects = set(config.get("privateProjects", []))
        self.hidden = set(config.get("hidden", []))
        self.private_titles = config.get("privateTitles", "prefix-only")      # default: owner's decision 2026-11-17
        if self.private_titles not in ("prefix-only", "redacted"):
            raise SetupError("config privateTitles must be \"prefix-only\" or \"redacted\"")
        public, derived, branches, whole_words = derive(private or {}, self.private_projects)
        self.public_repos = public
        for f in ("activity[].repo", GROUP_FIELD):
            self.allow.setdefault(f, set()).update(public)
        self.allow.setdefault("activity[].branch", set()).update(branches)
        self.codes = set(config.get("codes", []))
        private_words = {t.casefold() for t in terms["terms"]} | {n.casefold() for n in derived}
        if any(c.casefold() in private_words for c in self.codes):
            raise SetupError("config codes: a code is on the private word list or a private name")
        self.keywords = [k for k in config.get("keywords", []) if k]
        owners = sorted(config.get("githubOwners", []))
        owner = "|".join(map(re.escape, owners))
        repos = "|".join(map(re.escape, sorted(self.public_repos)))
        self.repo_url = re.compile(r"https://github\.com/(?:" + owner + r")/(?:" + repos + r")/commit/[0-9a-f]{7,40}") \
            if repos and owners else None                # no configured owner: no link is public
        vocab = vocabulary()
        allowed_values = set().union(*self.allow.values()) if self.allow else set()
        runtime = [n for n in derived
                   if norm(n) and norm(n) not in vocab and n not in allowed_values
                   and not (re.fullmatch(r"[A-Z]", n) or n in self.codes)]     # codes are public by design
        words = [t for t in terms.get("terms", []) if t and t.casefold() not in allow_words]
        self.names = sorted(set(words) | set(runtime) | set(self.keywords) | self.private_projects,
                            key=len, reverse=True)
        for n in whole_words:                    # commit ids, branch parts: whole words only
            self.modes.setdefault(n.casefold(), "word")
        self.matchers = self._compile(self.names)
        # A name both public and private is a contradiction the exporter must not have resolved
        # towards public (review H1): allowlists or visibility flags disagree.
        private_keys = {norm(n) for n in set(words) | set(derived) | set(self.keywords) | self.private_projects}
        shown = {v for f in ("activity[].repo", GROUP_FIELD) for v in self.allow.get(f, ())}
        self.conflicts = sorted(v for v in shown if norm(v) in private_keys)

    def _compile(self, names):
        """(index, 'sub', normalised) or (index, 'word', word list) per term."""
        out = []
        for i, t in enumerate(names, 1):
            n = norm(t)
            if not n:
                continue
            mode = self.modes.get(t.casefold()) or ("substring" if len(n) >= 5 or not n.isascii() else "word")
            out.append((i, "sub", n) if mode == "substring" else (i, "word", words(t)))
        return out

    # --- text checks --------------------------------------------------------------------------

    def name_hits(self, text):
        """Ordinals of the private words found (never the words themselves)."""
        flat, ws, hits = norm(text), None, set()
        for i, mode, pat in self.matchers:
            if mode == "sub":
                if pat in flat:
                    hits.add(i)
            else:
                ws = ws if ws is not None else words(text)
                k = len(pat)
                if k and any(ws[j:j + k] == pat for j in range(len(ws) - k + 1)):
                    hits.add(i)
        return hits

    def check_text(self, text, where, is_html=False):
        bad = []
        variants = {"raw": text}
        variants.update((f"decoded x{i}", t) for i, t in enumerate(decodings(text), 1))
        seen = set()
        for how, t in variants.items():
            for h in sorted(self.name_hits(t)):
                if ("name", h) not in seen:
                    seen.add(("name", h))
                    bad.append(f"{where}: private name #{h} ({how})")
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
            for rx in (REL_URL, PROTO_REL):
                for m in rx.finditer(t):
                    if ("rel", m.group(0)) not in seen:
                        seen.add(("rel", m.group(0)))
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

    def check_dir(self, d):
        """The publish directory: index.html and optionally CNAME, nothing else (review M2c)."""
        d = Path(d)
        bad, entries = [], sorted(d.rglob("*"))
        for e in entries:
            rel = e.relative_to(d).as_posix()
            if e.is_symlink() or e.is_dir() or rel not in ("index.html", "CNAME"):
                bad.append(f"{d.name}/: unexpected entry #{entries.index(e) + 1} "
                           f"({'directory' if e.is_dir() else 'symlink' if e.is_symlink() else 'file'}); "
                           "only index.html and CNAME may be published")
        if not (d / "index.html").is_file():
            bad.append(f"{d.name}/: no index.html")
        cname = d / "CNAME"
        if cname.is_file() and not cname.is_symlink():
            try:
                lines = cname.read_text(encoding="ascii").strip().splitlines()
            except (OSError, UnicodeDecodeError):
                lines = []
            if len(lines) != 1 or not CNAME_RX.fullmatch(lines[0].strip()):
                bad.append(f"{d.name}/CNAME: must be exactly one domain name")
        index = d / "index.html"
        if index.is_file() and not index.is_symlink():
            bad += self.check_file(index)
        return bad

    def check_html_structure(self, text, where):
        """CSP head, one inline data script, no external or extra writers of GB (review M2b-d)."""
        bad = []
        if not HEAD_RX.match(text):
            bad.append(f"{where}: must start with <!doctype html><html><head> and the exact CSP <meta> first")
        if len(re.findall(r"(?i)http-equiv", text)) != 1:
            bad.append(f"{where}: exactly one http-equiv <meta> (the CSP) is allowed")
        p = _Parse()
        try:
            p.feed(text)
            p.close()
        except Exception:                             # noqa: BLE001 — any parser failure rejects
            return bad + [f"{where}: HTML could not be parsed"], None
        for tag, attrs in p.tags:
            if tag in DENY_TAGS:
                bad.append(f"{where}: <{tag}> is not allowed in the snapshot")
            for k, v in attrs:
                k, v = (k or "").lower(), (v or "").strip()
                if k in URL_ATTRS and v and not v.startswith("#") and not (
                        k in ("src", "srcset", "poster") and v.lower().startswith("data:") and "," in v) and not (
                        tag == "a" and k == "href" and self.repo_url and self.repo_url.fullmatch(v)):
                    bad.append(f"{where}: <{tag} {k}=...> must be empty, #fragment or data:")
                if k == "style" and CSS_URL.search(v):
                    bad.append(f"{where}: <{tag} style> loads a resource")
                if k.startswith("on") and PROTO_REL.search(v):
                    bad.append(f"{where}: <{tag} {k}> refers to an external host")
        for attrs, body in p.styles:
            if CSS_URL.search(body):
                bad.append(f"{where}: <style> uses url() or @import that is not data:")
        data, page = [], None
        for attrs, body in p.scripts:
            if any((k or "").lower() == "src" for k, _ in attrs):
                bad.append(f"{where}: <script src> is not allowed; inline everything")
            m = GB_SCRIPT.fullmatch(body)
            if m and m.group(1).startswith("{"):
                data.append(m.group(1))
            elif GB_WRITE.search(body):
                bad.append(f"{where}: a script other than the data script writes GB")
        if len(data) != 1:
            bad.append(f"{where}: needs exactly one <script> holding only window.GB = {{...}}; (found {len(data)})")
        else:
            try:
                page = strict_json(data[0])
            except ValueError as e:
                bad.append(f"{where}: window.GB is not valid JSON ({'duplicate key' if isinstance(e, DuplicateKey) else 'syntax'})")
        return bad, page

    def check_file(self, path):
        p = Path(path)
        if p.is_dir():
            return self.check_dir(p)
        try:
            text = p.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as e:
            return [f"{p.name}: unreadable ({e.__class__.__name__})"]
        suffix = p.suffix.lower()
        is_html = suffix in (".html", ".htm")
        if suffix not in (".json", ".html", ".htm"):
            return [f"{p.name}: only the publish directory, index.html or the page JSON can be checked; "
                    "a snapshot has no other files"]
        bad = self.check_text(text, p.name, is_html)
        if is_html:
            more, page = self.check_html_structure(text, p.name)
            bad += more
            if page is None:
                return bad
        else:
            try:
                page = strict_json(text)
            except ValueError as e:
                return bad + [f"{p.name}: not valid JSON ({'duplicate key' if isinstance(e, DuplicateKey) else 'syntax'})"]
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
        return strict_json(Path(path).expanduser().read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise SetupError(f"{what} {Path(path).name}: {e.__class__.__name__}") from None


def check_terms(t):
    """Schema of redact_terms (review H2): a misspelt key must not silently mean "no terms"."""
    if not isinstance(t, dict):
        raise SetupError("terms file is not an object")
    extra = set(t) - {"_note", "terms", "allow", "match"}
    if extra:
        raise SetupError(f"terms file: {len(extra)} unknown key(s)")
    words = t.get("terms")
    if not (isinstance(words, list) and words and all(isinstance(w, str) and w.strip() for w in words)):
        raise SetupError("terms file: terms must be a non-empty list of non-empty strings")
    if not (isinstance(t.get("allow", []), list) and all(isinstance(w, str) for w in t.get("allow", []))):
        raise SetupError("terms file: allow must be a list of strings")
    m = t.get("match", {})
    if not (isinstance(m, dict) and all(isinstance(k, str) and v in ("substring", "word") for k, v in m.items())):
        raise SetupError("terms file: match maps a term to substring or word")


CONFIG_KEYS = {"privateTitles", "hidden", "keywords", "privateProjects", "codes", "githubOwners", "allow"}


def check_config(c):
    extra = set(c) - CONFIG_KEYS
    if extra:
        raise SetupError(f"config: unknown key(s) {sorted(extra)}")
    for k in ("hidden", "keywords", "privateProjects", "codes", "githubOwners"):
        if not (isinstance(c.get(k, []), list) and all(isinstance(x, str) for x in c.get(k, []))):
            raise SetupError(f"config: {k} must be a list of strings")
    if not isinstance(c.get("allow", {}), dict):
        raise SetupError("config: [allow] must be a table")
    bad = [k for k in c.get("allow", {}) if FIELDS.get(k, "").rstrip("?") != "text"]
    if bad:
        raise SetupError(f"config [allow]: not text fields {bad}")
    hideable = FIELDS["hidden[]"].partition(":")[2].split("|")
    if any(h not in hideable for h in c.get("hidden", [])):
        raise SetupError("config: unknown hidden block")


def load_toml(path):
    """Missing config is an error (review H2); --no-config passes None for fabricated examples."""
    if path is None:
        return {}
    p = Path(path).expanduser()
    if not p.is_file():
        raise SetupError(f"config {p.name} not found (--no-config only for fabricated examples)")
    try:
        return tomllib.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise SetupError(f"config {p.name}: {e.__class__.__name__}") from None


def main(argv=None):
    ap = argparse.ArgumentParser(prog="verify_public")
    ap.add_argument("files", nargs="+")
    ap.add_argument("--terms", default=str(ROOT / ".local" / "redact_terms.local.json"))
    ap.add_argument("--config", default=str(ROOT / ".local" / "public.local.toml"))
    ap.add_argument("--no-config", action="store_true", help="strictest settings; fabricated examples only")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--private", help="the private page/1 the snapshot was exported from (visibility and "
                                     "private names are derived from it, independently of the exporter)")
    g.add_argument("--no-private", action="store_true", help="fabricated examples only")
    a = ap.parse_args(argv)
    try:
        terms = load_json(a.terms, "terms file")
        private = None if a.no_private else load_json(a.private, "private page")
        if private is not None and (not isinstance(private, dict) or private.get("schema") != "glassbox.page/1"):
            raise SetupError("--private is not a glassbox.page/1 page")
        gate = Gate(terms, private, load_toml(None if a.no_config else a.config))
    except SetupError as e:
        print(f"setup error: {e}", file=sys.stderr)
        return 2
    total = 0
    for c in gate.conflicts:
        total += 1
        print(f"name is both public and private: {hide(c)}")
    for f in a.files:
        for b in gate.check_file(f):
            total += 1
            print(b)
    print(f"\nchecked {len(a.files)} file(s): {'REJECTED, ' + str(total) + ' problem(s)' if total else 'clean'}")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
