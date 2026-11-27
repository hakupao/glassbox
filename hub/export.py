"""Public export: build the public glassbox.page/1 from the private one (CONTRACT §3).

The public page is rebuilt from schema/public_fields.json (rule 1), never trimmed from the
private one: a path not in that table cannot reach the output. On the way:

- Text fields are replaced by {"masked": true} unless the value is on that field's allowlist
  (rule 2). Public repo names come from the page's own `public` flags (GitHub visibility), minus
  `privateProjects`; branches of public commits are allowed when they carry no private name.
- Private commits (rule 4) lose branch / hash / url / machine, and `t` is cut to the hour.
  Gitea commits and repos listed in `privateProjects` count as private.
- Commit titles (rule 5), public and private alike, lose secrets, e-mails, IPs, paths, URLs,
  ticket ids, blocked keywords and every private name (normalised match, so `FalconLedger` and
  `falcon_ledger` both go). Private titles keep only a prefix such as `fix:` (`privateTitles =
  "prefix-only"`, the default by the owner's decision of 2026-11-17); "redacted" keeps the scrubbed text.
  A title that spells a private name only together with the JSON around it, in the page JSON or in
  index.html (where "<" is escaped), is cut to its prefix too (backlog A5); so is one that spells a name
  or pattern once decoded the way the gate decodes (\\u.., \\x.., 'a'+'b', ...), and a prefix that still
  joins into a name becomes ****** (A6). A public branch that joins into a name becomes null (A6). The same
  happens when a title or branch forms one of the gate's patterns only once serialised or decoded (A8: "\\r\\n"
  is "\\\\r\\\\n" in JSON, a \\\\host\\ path to the gate).
- today.byProject and each usageDays[].byProject merge private projects into one {"masked": true, "group": "private"} row.
- Quota rows without an account code are dropped; unknown models become "other".
- Hidden blocks are [] (rule 7).
- usageDays: each day's totals and its byAgent / byModel / byMachine rows (numbers, agent and model ids, machine
  codes; a machine without a public code is left out); byProject follows today.byProject, one merged private row a day.
- Numbers the owner made public on 2026-11-27: today.hourly, machines[].todayByAgent, machines[].history[].diskPct,
  contributions.githubOfficialTotal.
- Commit files (S17 R09): `files` only on public, pushed GitHub commits, at most 50, and only when
  every path is a clean repo-relative path that carries no private name, term, branch part, commit
  id or pattern the gate looks for; otherwise that one commit keeps only its count `nFiles`. The
  snapshot is never refused because of a path. `author` only on public commits and only when it is
  one of the configured `authors` and no private word; otherwise null.
- Branch parts (R10, D4): a part of a private branch is a private name unless it is listed in
  `branchFragments` (each entry split on - / _ like a branch), spells a public repo name, or (A9) is a word of the
  page's own static code (web/index.html and the .js / .css it inlines, e.g. "route" of data-route). A listed or
  page-code part that is a component of a private name, term, keyword or private project stays private.

Visibility (review H1): a repo / project name is public only if every occurrence in the page
(activity, today.byProject, code.*, usageDays[].byProject) is public and not Gitea.

export() also returns a context (private names, public repos and branches) for diagnostics; the
gate derives its own from the private page. It holds real names: write it only under a gitignored
path (--context, off by default).

    python -m hub.export PRIVATE.json [--config .local/public.local.toml]
        [--terms .local/redact_terms.local.json] [--out out/page.public.json]
        [--context .cache/export-context.json] [--site out/site]

--site writes the publish directory: index.html = hub.bundle.bundle(public page), nothing else.
Run scripts/verify_public.py on that directory before pushing it.

Config format: docs/public.example.toml. A missing config file is an error; --no-config (fabricated
examples only) means the strictest settings.
"""
import argparse
import collections
import copy
import functools
import html
import json
import math
import re
import sys
import tomllib
import unicodedata
import urllib.parse
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIELDS = json.loads((ROOT / "schema" / "public_fields.json").read_text(encoding="utf-8"))["paths"]
MODELS = set(json.loads((ROOT / "probe" / "pricing.json").read_text(encoding="utf-8"))["models"])
DEFAULT_CONFIG = ROOT / ".local" / "public.local.toml"
DEFAULT_TERMS = ROOT / ".local" / "redact_terms.local.json"

MASK = {"masked": True}
MASK_PRIVATE = {"masked": True, "group": "private"}
RED = "******"
HIDEABLE = set(FIELDS["hidden[]"].partition(":")[2].split("|"))
COMMIT_TYPES = {"feat", "fix", "docs", "style", "refactor", "perf", "test", "tests", "build", "ci",
                "chore", "revert", "wip", "merge", "release", "deps", "init"}
GENERIC_BRANCH = {"main", "master", "dev", "develop", "development", "feature", "features", "feat", "fix", "fixes",
                  "bugfix", "hotfix", "release", "releases", "wip", "trunk", "stage", "staging", "prod",
                  "production", "test", "tests", "chore", "docs", "refactor", "update", "patch", "draft", "temp",
                  "backup", "experiment"}
NAME_FIELDS_SKIP = {"activity[].branch"}     # branches are not names; private ones are nulled anyway

# Title scrubbing, applied in this order. The gate has its own, independent set.
SCRUB = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}"
               r"|sk-[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{6,}|npm_[A-Za-z0-9]{16,}|hf_[A-Za-z0-9]{16,}"
               r"|xox[a-z]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})"),
    re.compile(r"\beyJ[\w-]{3,}\.[\w-]{3,}(?:\.[\w-]*)?"),                                  # JWT
    re.compile(r"(?i)\b[\w-]+(?:\.[\w-]+)*\.(?:ts\.net|local|lan|internal|home\.arpa)\b\S*"),   # LAN hosts
    re.compile(r"(?i)\b(?:[\w-]+\.)+[a-z]{2,}/\S*"),                                       # domain/path
    re.compile(r"(?i)\b(?:password|passwd|pwd|secret|token|api[_-]?key|auth)\s*[=:]\s*\S+"),
    re.compile(r"\b[A-Za-z][A-Za-z0-9+.-]*://\S*"),                                   # any URL
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),                     # e-mail
    re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?!\w|\.\d)"),             # IPv4
    re.compile(r"(?i)\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b|\b(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}\b)?"),  # IPv6
    re.compile(r"(?:[A-Za-z]:\\|\\\\)[^\s'\"`)]*"),                                    # Windows path
    re.compile(r"\S*(?:/Users/|/home/|/Volumes/|/root/|/private/|/mnt/|/srv/|/var/)\S*"),  # well-known dirs
    re.compile(r"(?<![\w.~])(?:~|\.{1,2})?/[\w.~-]+(?:/\S*)?"),                         # rooted path
    re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b"),                                             # ticket id
    re.compile(r"\b[0-9a-f]{32,}\b"),                                                  # long hex blobs
]


# What the gate looks for in EVERY value, not only in titles (paths are not titles: a ticket-like
# docs/ADR-001.md or a dotted src/MyApp.Core/ is fine). ':' '~' '\\' '%' '&' and quotes are not path
# characters (PATH_CHARS), so URLs, IPv6, drive letters and encodings cannot occur in a kept path.
PATH_FLAGS = SCRUB[:3] + [                                                          # private key, tokens, JWT
    re.compile(r"(?i)\b[\w-]+(?:\.[\w-]+)*\.(?:ts\.net|home\.arpa)\b"),                   # tailnet / LAN hosts
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),                       # e-mail
    re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?!\w|\.\d)"),                         # IPv4
    re.compile(r"/(?:Users|home|Volumes|root|private|mnt|srv|var)/"),                  # well-known dirs
]


class ExportError(Exception):
    pass


def _no_constant(name):
    raise ValueError("NaN / Infinity")                    # review L6


# --- config ----------------------------------------------------------------------------------

CONFIG_KEYS = {"privateTitles", "hidden", "keywords", "privateProjects", "codes", "githubOwners", "allow",
               "authors", "branchFragments"}
LOGIN = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})")          # a GitHub login
FILES_MAX = 50
PATH_MAX = 300
FILE_STATUS = ("M", "A", "R", "D")
# Characters a published path may hold. Anything else (%, &, \, quotes, <, >, :, ~, =, ...) could be
# decoded or read as a URL, path or address by the gate, so such a commit keeps only its count.
PATH_CHARS = re.compile(r"[\w .\-/+@,()\[\]#!$]+")
TERMS_KEYS = {"_note", "terms", "allow", "match"}


def load_config(path=DEFAULT_CONFIG, terms=None):
    """Read public.local.toml. A missing file is an error (review H2); path=None (--no-config,
    fabricated examples only) gives the strictest settings: nothing allowlisted, no commit links,
    private titles prefix-only. Unknown keys are refused, so a typo cannot switch a rule off."""
    if path is None:
        raw = {}
    else:
        p = Path(path).expanduser()
        if not p.is_file():
            raise ExportError(f"config {p.name} not found (use --no-config only for fabricated examples)")
        try:
            raw = tomllib.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            raise ExportError(f"config {p.name}: {e.__class__.__name__}") from None
    unknown = sorted(set(raw) - CONFIG_KEYS)
    if unknown:
        raise ExportError(f"config: unknown key(s) {unknown}")
    cfg = {
        "privateTitles": raw.get("privateTitles", "prefix-only"),
        "hidden": list(raw.get("hidden", [])),
        "keywords": [k for k in raw.get("keywords", []) if k],
        "privateProjects": set(raw.get("privateProjects", [])),
        "codes": set(raw.get("codes", [])),
        "githubOwners": set(raw.get("githubOwners", [])),
        "allow": {k: set(v) for k, v in raw.get("allow", {}).items()},
        "authors": raw.get("authors", []),
        "branchFragments": raw.get("branchFragments", []),
    }
    for k in ("authors", "branchFragments"):
        if not (isinstance(cfg[k], list) and all(isinstance(x, str) and x.strip() for x in cfg[k])):
            raise ExportError(f"{k} must be a list of non-empty strings")
    if not all(LOGIN.fullmatch(a) for a in cfg["authors"]):
        raise ExportError("authors: each entry must be a GitHub login")
    cfg["authors"] = set(cfg["authors"])
    if cfg["privateTitles"] not in ("redacted", "prefix-only"):
        raise ExportError("privateTitles must be \"redacted\" or \"prefix-only\"")
    bad = [h for h in cfg["hidden"] if h not in HIDEABLE]
    if bad:
        raise ExportError(f"hidden: unknown block(s) {bad}; allowed: {sorted(HIDEABLE)}")
    unknown = [k for k in cfg["allow"] if FIELDS.get(k, "").rstrip("?") != "text"]
    if unknown:
        raise ExportError(f"[allow]: not text fields {unknown}")
    if terms is not None:
        clash = {c for c in cfg["codes"] if c.casefold() in {t.casefold() for t in terms["terms"]}}
        if clash:
            raise ExportError(f"config codes: {len(clash)} code(s) are on the private word list")
    return cfg


def load_terms(path=DEFAULT_TERMS):
    """{"terms": [...], "allow": [...], "match": {term: "substring"|"word"}}. Missing file, an unknown
    key or a malformed list is an error (review H2): a misspelt key must not mean "no terms"."""
    try:
        data = json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise ExportError(f"terms file {Path(path).name}: {e.__class__.__name__}") from None
    if not isinstance(data, dict) or set(data) - TERMS_KEYS:
        raise ExportError(f"terms file: unknown key(s) {sorted(set(data) - TERMS_KEYS) if isinstance(data, dict) else ''}")
    t, al, mt = data.get("terms"), data.get("allow", []), data.get("match", {})
    if not (isinstance(t, list) and t and all(isinstance(x, str) and x.strip() for x in t)):
        raise ExportError("terms file: \"terms\" must be a non-empty list of non-empty strings")
    if not (isinstance(al, list) and all(isinstance(x, str) for x in al)):
        raise ExportError("terms file: \"allow\" must be a list of strings")
    if not (isinstance(mt, dict) and all(isinstance(k, str) and v in ("substring", "word") for k, v in mt.items())):
        raise ExportError("terms file: \"match\" maps a term to \"substring\" or \"word\"")
    allow = {a.casefold() for a in data.get("allow", [])}
    return {"terms": [t for t in data.get("terms", []) if t and t.casefold() not in allow],
            "match": {k.casefold(): v for k, v in data.get("match", {}).items()}}


# --- name matching (CONTRACT §3 rule 6) --------------------------------------------------------

# Look-alike letters folded to Latin before matching (review M1). Cyrillic and Greek only.
HOMOGLYPHS = str.maketrans({
    "а": "a", "в": "b", "е": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t",
    "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ӏ": "l", "ԛ": "q", "ԝ": "w",
    "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T",
    "Х": "X", "І": "I", "Ј": "J", "Ѕ": "S",
    "α": "a", "β": "b", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u",
    "χ": "x", "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N",
    "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X",
})


def _fold(s):
    s = unicodedata.normalize("NFKC", s)
    return "".join(c for c in s if unicodedata.category(c) != "Cf").translate(HOMOGLYPHS)


def norm(s):
    """Long-term form: NFKC, look-alikes folded, case-folded, only letters and digits kept."""
    return "".join(c for c in _fold(s).casefold() if unicodedata.category(c)[0] in "LN")


def tokens(s):
    """Words for short terms: split on anything that is not a letter or digit (so _ too), on
    camelCase, on letter/digit changes and on Latin/other-script changes (review L2)."""
    s = _fold(s)
    s = re.sub(r"(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])", " ", s)
    s = re.sub(r"(?<=[^\W\d_])(?=\d)|(?<=\d)(?=[^\W\d_])", " ", s)
    s = re.sub(r"(?<=[A-Za-z])(?=[^\W\d_A-Za-z])|(?<=[^\W\d_A-Za-z])(?=[A-Za-z])", " ", s)
    return [w.casefold() for w in re.split(r"[^\w]|_", s) if w]


def _vocabulary():
    """Words the public page is made of: enum / const values and keys. A private name equal to
    one of them reveals nothing and would otherwise block every export (e.g. p_other's "other")."""
    words = {"other", "masked", "group", "private", "public", "glassbox"}
    for path, typ in FIELDS.items():
        words.update(k for k in re.split(r"[.\[\]]+", path) if k)
        kind, _, arg = typ.rstrip("?").partition(":")
        if kind in ("enum", "const"):
            words.update(arg.split("|"))
            words.update(w for v in arg.split("|") for w in re.split(r"[^A-Za-z0-9-]+", v) if w)
    return {norm(w) for w in words}


VOCAB = _vocabulary()
WEB = ROOT / "web"
_REFERENCED = re.compile(r'<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"/:]+\.(?:js|css))"')
_INLINED_TAG = re.compile(r'<link rel="stylesheet" href="[a-z0-9-]+\.css">|<script src="[a-z0-9-]+\.js"></script>')


def page_code_words(web=None):
    """A9: normalised tokens of the public page's own static code as hub.page.bundle() ships it: web/index.html
    without the <link> / <script src> tags it replaces, plus every .js / .css that index.html references. Only
    for branch parts (see export()). The gate keeps its own copy (verify_public.page_code_words(), the files of its
    web_bodies()); tests/test_bundle_gate.py checks both give the same set. Encoded data runs (DATA_RUN, e.g. the
    base64-like art data in art.js) are left out. Missing web/: empty; a symbolic link (web/, index.html or a
    referenced file): ExportError, checked before anything is read (a link could make private data look like page code)."""
    web = Path(web or WEB)
    index = web / "index.html"
    if web.is_symlink() or index.is_symlink():
        raise ExportError("web/: symbolic links are not allowed in the shipped page code")
    if not web.is_dir() or not index.is_file():
        return frozenset()
    template = index.read_text(encoding="utf-8")
    texts = set()
    for n in _REFERENCED.findall(template):
        f = web / n
        if f.is_symlink() or index.is_symlink() or web.is_symlink():
            raise ExportError("web/: symbolic links are not allowed in the shipped page code")
        if f.is_file():
            texts.add("\n" + f.read_text(encoding="utf-8"))
    return _code_words("\n".join([_INLINED_TAG.sub("", template), *sorted(texts)]))


DATA_RUN = re.compile(r"[A-Za-z0-9+/=]{64,}")


@functools.cache
def _code_words(text):
    return frozenset(n for n in map(norm, tokens(DATA_RUN.sub(" ", text))) if n)


class Matcher:
    """CONTRACT §3 rule 6. Long terms (5+ after norm) or non-Latin ones: substring of norm(text).
    Short terms: a run of whole tokens. `modes` maps a casefolded term to "substring" or "word"."""

    def __init__(self, names, modes):
        self.long, self.short = set(), []
        self.url_rx = None                # public commit links (export() sets it): not a pattern hit (A8)
        for t in names:
            n = norm(t)
            if not n:
                continue
            mode = modes.get(t.casefold()) or (
                "substring" if len(n) >= 5 or not n.isascii() else "word")
            if mode == "substring":
                self.long.add(n)
            elif tokens(t):
                self.short.append(tokens(t))

    def hits(self, text):
        """Every term found in text (as its normal form or token tuple): to tell which hits are new."""
        flat, toks = norm(text), tokens(text)
        out = {n for n in self.long if n in flat}
        for tt in self.short:
            k = len(tt)
            if any(toks[i:i + k] == tt for i in range(len(toks) - k + 1)):
                out.add(tuple(tt))
        return out

    def hit(self, text):
        flat = norm(text)
        if any(n in flat for n in self.long):
            return True
        toks = tokens(text)
        for tt in self.short:
            k = len(tt)
            if any(toks[i:i + k] == tt for i in range(len(toks) - k + 1)):
                return True
        return False


def decode(text, rounds=4):
    """Undo %-encoding and HTML entities until nothing changes (review L9)."""
    for _ in range(rounds):
        nxt = html.unescape(urllib.parse.unquote(text))
        if nxt == text:
            break
        text = nxt
    return text


def gate_layers(text, limit=8):
    """The decoded layers the gate checks besides the raw text (backlog A6). Reimplemented, not shared:
    mirrors scripts/verify_public.py decodings() and _chr() (lines 239-263): the same steps in the same
    order, the same round limit; tests/test_export.py compares the two on a table of inputs."""
    def ch(h):
        try:
            return chr(int(h, 16))
        except (ValueError, OverflowError):
            return ""
    out, t = [], text
    for _ in range(limit):
        n = html.unescape(t)
        n = re.sub(r"\\u\{([0-9a-fA-F]{1,6})\}", lambda m: ch(m.group(1)), n)
        n = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: ch(m.group(1)), n)
        n = re.sub(r"\\x([0-9a-fA-F]{2})", lambda m: ch(m.group(1)), n)
        n = re.sub(r"\\([0-9a-fA-F]{1,6})\s?", lambda m: ch(m.group(1)), n)
        n = n.replace("\\/", "/")
        n = urllib.parse.unquote(n)
        n = re.sub(r"([\"'`])\s*\+\s*([\"'`])", "", n)
        if n == t:
            break
        out.append(n)
        t = n
    return out


def scrub_title(title, matcher):
    """A title that mentions a private name is cut to its prefix (review L9); then regexes. A title the
    gate's decoding turns into a private name or a pattern (\\u006f, \\x6f, 'o'+'wl', ...) is cut too
    (backlog A6); the published text stays as written, only %-encoding and entities are undone."""
    t = decode(title)
    if any(matcher.hit(x) for x in [t, *gate_layers(t)]):
        t = prefix_only(t)
        if matcher.hit(t):
            t = RED
    for rx in SCRUB:
        t = rx.sub(RED, t)
    if any(matcher.hit(x) or any(rx.search(x) for rx in SCRUB) for x in gate_layers(t)):
        t = prefix_only(t)
    return t


def prefix_only(title):
    m = re.match(r"\s*([A-Za-z]+)(?:\([^)]*\))?!?:", title)
    return f"{m.group(1).lower()}:" if m and m.group(1).lower() in COMMIT_TYPES else RED


# --- whitelist rebuild (CONTRACT §3 rule 1) ----------------------------------------------------

def generic(path):
    return re.sub(r"\[\d+\]", "[]", path)


_CONTAINERS = set()
for _p in FIELDS:
    _parts = re.split(r"(?=\.)|(?=\[\])", _p)
    for _i in range(1, len(_parts)):
        _CONTAINERS.add("".join(_parts[:_i]).lstrip("."))


def _walk_text(node, path, out):
    """(generic path, value) for every text-typed leaf in the private page."""
    if isinstance(node, dict):
        for k, v in node.items():
            _walk_text(v, f"{path}.{k}" if path else k, out)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            _walk_text(v, f"{path}[{i}]", out)
    elif isinstance(node, str) and FIELDS.get(generic(path), "").rstrip("?") == "text":
        out.append((generic(path), node))


def _rebuild(node, path, allowed):
    g = generic(path)
    if g in FIELDS:
        typ = FIELDS[g]
        if typ.rstrip("?") != "text":
            return node
        if node is None and typ.endswith("?"):
            return None
        if node is _PRIVATE_GROUP:
            return dict(MASK_PRIVATE)
        return node if isinstance(node, str) and node in allowed(g) else dict(MASK)
    if node is None:
        return _DROP
    if g + "[]" in _CONTAINERS or g + "[]" in FIELDS:
        if not isinstance(node, list):
            raise ExportError(f"{path}: expected a list")
        return [r for i, v in enumerate(node) if (r := _rebuild(v, f"{path}[{i}]", allowed)) is not _DROP]
    if not path or g in _CONTAINERS:
        if not isinstance(node, dict):
            raise ExportError(f"{path}: expected an object")
        out = {}
        for k, v in node.items():
            r = _rebuild(v, f"{path}.{k}" if path else k, allowed)
            if r is not _DROP:
                out[k] = r
        return out
    return _DROP


_DROP = object()
_PRIVATE_GROUP = object()


# --- own type check: refuse to emit what the gate would reject ---------------------------------

ISO = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)")


def _is_iso(v):
    if not (isinstance(v, str) and ISO.fullmatch(v)):
        return False
    try:
        datetime.fromisoformat(v)
    except ValueError:
        return False
    return True


def _type_ok(v, typ, cfg, url_rx):
    if typ.endswith("?"):
        if v is None:
            return True
        typ = typ[:-1]
    kind, _, arg = typ.partition(":")
    if kind == "number":
        return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
    if kind == "bool":
        return isinstance(v, bool)
    if kind == "null":
        return v is None
    if kind == "text":
        return _is_placeholder(v) or isinstance(v, str)
    if not isinstance(v, str):
        return False
    if kind == "iso":
        return _is_iso(v)
    return {
        "date": lambda: bool(re.fullmatch(r"\d{4}-\d\d-\d\d", v)),
        "hash": lambda: bool(re.fullmatch(r"[0-9a-f]{7,40}", v)),
        "semver": lambda: bool(SEMVER.fullmatch(v)),
        "enum": lambda: v in arg.split("|"),
        "const": lambda: v == arg,
        "code": lambda: is_code(v, cfg),
        "model": lambda: v in MODELS or v == "other",
        "url": lambda: bool(url_rx and url_rx.fullmatch(v)),
        "title": lambda: True,
        "path": lambda: is_path(v),
        "author": lambda: v in cfg["authors"] and bool(LOGIN.fullmatch(v)),
    }[kind]()


def is_path(v):
    """Type `path`: repo-relative, no leading /, no . or .. or blank segment, no drive letter or
    backslash, no control / format characters, at most PATH_MAX characters."""
    return (isinstance(v, str) and 0 < len(v) <= PATH_MAX and not v.startswith("/") and "\\" not in v
            and not re.match(r"[A-Za-z]:", v) and not any(unicodedata.category(c)[0] == "C" for c in v)
            and all(seg.strip() and seg not in (".", "..") for seg in v.split("/")))


def branch_parts(listed):
    """Normalised parts of the configured branchFragments, split like branch names."""
    return {norm(x) for w in listed for x in re.split(r"[-/_]+", w) + [w] if norm(x)}


def clean_path(p, matcher):
    """A path the gate will not refuse: the path type, a plain character set, no private word and
    none of the patterns the gate checks in every value (PATH_FLAGS)."""
    return (is_path(p) and bool(PATH_CHARS.fullmatch(p)) and not matcher.hit(p)
            and not any(rx.search(p) for rx in PATH_FLAGS))


SEMVER = re.compile(r"\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)(?:\.\d+)?)?")      # review L3


def _is_placeholder(v):
    """Exactly one of the two placeholder shapes, with `masked` that `is True` (review L8)."""
    return isinstance(v, dict) and v.get("masked") is True and (
        set(v) == {"masked"} or (set(v) == {"masked", "group"} and v["group"] == "private"))


def _check(node, path, cfg, url_rx, bad):
    g = generic(path)
    if g in FIELDS and isinstance(node, (dict, list)) and not (
            FIELDS[g].rstrip("?") == "text" and _is_placeholder(node)):
        bad.append(f"{path}: a {type(node).__name__} where {FIELDS[g]} is expected")
    elif isinstance(node, dict) and not _is_placeholder(node):
        for k, v in node.items():
            _check(v, f"{path}.{k}" if path else k, cfg, url_rx, bad)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            _check(v, f"{path}[{i}]", cfg, url_rx, bad)
    elif g not in FIELDS:
        bad.append(f"{path}: not a public field")
    elif not _type_ok(node, FIELDS[g], cfg, url_rx):
        bad.append(f"{path}: not {FIELDS[generic(path)]} (a {type(node).__name__})")


# --- export ------------------------------------------------------------------------------------

def is_code(v, cfg):
    return isinstance(v, str) and (bool(re.fullmatch(r"[A-Z]", v)) or v in cfg["codes"])


def _hour(t):
    dt = datetime.fromisoformat(t).replace(minute=0, second=0, microsecond=0)
    s = dt.isoformat(timespec="seconds")
    return s[:-6] + "Z" if t.endswith("Z") and s.endswith("+00:00") else s


PROJECT_FIELDS = ("today.byProject[].project", "usageDays[].byProject[].project")     # public repo names, or the merged private row
VISIBILITY_SITES = (("activity", "repo"), ("today.byProject", "project"), ("code.commits", "repo"),
                    ("code.repos", "repo"), ("usageDays[].byProject", "project"))


def visibility_sites(page):
    """(entry, key) for every place a repo / project name appears with a `public` flag."""
    def items(node, parts):
        if not parts:
            yield from (x for x in (node if isinstance(node, list) else []) if isinstance(x, dict))
            return
        head, rest = parts[0], parts[1:]
        many = head.endswith("[]")
        nxt = node.get(head.rstrip("[]")) if isinstance(node, dict) else None
        for x in (nxt if many and isinstance(nxt, list) else [nxt]):
            yield from items(x, rest)
    for path, key in VISIBILITY_SITES:
        for e in items(page, path.split(".")):
            yield e, key


def url_host(url):
    """Host of a private commit link, as a private name; GitHub itself is not private."""
    host = re.sub(r"^\w+://([^/]+).*", r"\1", url).lower()
    return "" if host in ("github.com", "www.github.com") else host


def public_url_rx(repos, owners):
    if not repos or not owners:          # no configured owner: no commit links at all
        return None
    owner = "|".join(map(re.escape, sorted(owners)))
    return re.compile(r"https://github\.com/(?:" + owner + r")/(?:" + "|".join(map(re.escape, sorted(repos)))
                      + r")/commit/[0-9a-f]{7,40}")


def export(page, cfg, terms):
    """Private page/1 dict -> (public page/1 dict, gate context). Raises ExportError."""
    if page.get("schema") != "glassbox.page/1":
        raise ExportError("input is not glassbox.page/1")
    src = copy.deepcopy(page)
    today = src.get("today") or {}
    activity = src.get("activity") or []
    by_project = today.get("byProject") or []

    # A repo / project name is public only if EVERY occurrence says public, is not from Gitea and
    # is not blacklisted; one private occurrence anywhere makes it private everywhere (review H1).
    # Names are compared normalised, so differently cased spellings share one verdict.
    verdict = {}
    for e, key in visibility_sites(src):
        name = e.get(key)
        if isinstance(name, str) and norm(name):
            ok = (e.get("public") is True and e.get("source") != "gitea"
                  and "gitea" not in (e.get("sources") or []))
            verdict[norm(name)] = verdict.get(norm(name), True) and ok
    for n in cfg["privateProjects"]:
        verdict[norm(n)] = False

    def is_public(e, key):
        return isinstance(e.get(key), str) and verdict.get(norm(e[key])) is True

    public_repos = {e[k] for e, k in visibility_sites(src) if is_public(e, k)}
    allow_all = set().union(*cfg["allow"].values()) | public_repos

    # Private names: every text value that will not be shown, and private repos / projects.
    # A machine without a configured label carries its own code as label (hub default); when that
    # code is public it reveals nothing (backlog A3). Judged per machine: the exemption needs the
    # label of that same machine to equal its id, and the id to be a public code.
    own_code = collections.Counter(m["label"] for m in src.get("machines") or [] if isinstance(m, dict)
                                   and isinstance(m.get("label"), str) and m["label"] == m.get("id")
                                   and is_code(m["label"], cfg))
    texts = []
    _walk_text(src, "", texts)
    kept = []
    for g, v in texts:                    # drop exactly one machines[].label per exempt machine
        if g == "machines[].label" and own_code[v] > 0:
            own_code[v] -= 1
        else:
            kept.append((g, v))
    texts = kept
    names = {v for g, v in texts if g not in NAME_FIELDS_SKIP and v not in cfg["allow"].get(g, ())
             and not (g in ("activity[].repo", *PROJECT_FIELDS) and v in public_repos)}
    names |= {e[k] for e, k in visibility_sites(src) if isinstance(e.get(k), str) and not is_public(e, k)}
    private_keys = {k for k, v in verdict.items() if not v}
    allow_all = {a for a in allow_all if norm(a) not in private_keys}
    # Codes (A, K, ...) are public by design.
    hashes, hosts, frags = set(), set(), set()
    clash = {c for c in cfg["codes"] if norm(c) in {norm(n) for n in names}}
    if clash:
        raise ExportError(f"config codes: {len(clash)} code(s) equal a private name")
    names = {n for n in names if norm(n) and norm(n) not in VOCAB and n not in allow_all and not is_code(n, cfg)}
    code = src.get("code") if isinstance(src.get("code"), dict) else {}
    commits = code.get("commits") if isinstance(code.get("commits"), list) else []
    for e in [x for x in activity + commits if isinstance(x, dict)]:
        if isinstance(e, dict) and not is_public(e, "repo"):
            if isinstance(e.get("hash"), str):
                hashes.add(e["hash"])
            if isinstance(e.get("url"), str):
                hosts.add(url_host(e["url"]))
            if isinstance(e.get("branch"), str):          # review M3: telling parts of private branches
                frags.update(f for f in re.split(r"[-/_]+", e["branch"])
                             if len(f) >= 4 and f.lower() not in GENERIC_BRANCH)
    hosts.discard("")
    # A part spelling a public repo name, in any case, reveals nothing (same rule as the gate);
    # other allowlisted values are per field and keep the exact match.
    shown = {norm(r) for r in public_repos if norm(r) not in private_keys}
    # R10 (D4): explicitly public parts, except a part that is a component of a private name, term,
    # keyword or blacklisted project ("Falcon-Tools" listed does not free the "falcon" of falcon-ledger).
    # Every Text value that is not a branch or a public repo counts here, allowlisted ones included: the
    # gate's private-name set, so the exporter is never looser than the gate.
    pub_norm = {norm(r) for r in public_repos}
    protected = {norm(x) for w in names | {v for g, v in texts if g not in NAME_FIELDS_SKIP and norm(v) not in pub_norm}
                 | set(terms["terms"]) | set(cfg["keywords"])
                 | cfg["privateProjects"]
                 for x in [w, *re.split(r"[-/_.\s]+", w)] if norm(x)}
    listed = branch_parts(cfg["branchFragments"]) - protected
    # A9: a word of the page's own code ("route" of data-route) reveals nothing and cannot be removed from the page,
    # under the same guard: a component of a private name, term, keyword or project ("falcon" of falcon-ledger) stays
    # private even if web/ code has it, so no title shows part of a private name; the gate then refuses the page while
    # such a branch exists (fail closed). Components only: "format" inside a longer private word is freed. The guard
    # also takes the tokens() of each value (RouteKestrel: route, kestrel). Parts of commit ids and URL hosts are not
    # guarded (the whole id or host stays private, review L2); this guard is a little stricter than the gate's (it
    # counts allowlisted values and allowed terms too, review L3): stricter only cuts more.
    guard = protected | {norm(x) for w in names | {v for g, v in texts if g not in NAME_FIELDS_SKIP and norm(v) not in pub_norm}
                         | set(terms["terms"]) | set(cfg["keywords"]) | cfg["privateProjects"]
                         for x in tokens(w) if norm(x)}
    pcode = page_code_words() - guard
    frags = {f for f in frags if norm(f) not in VOCAB and f not in allow_all and norm(f) not in shown
             and norm(f) not in listed and not is_code(f, cfg)}
    # Review M1: private commit titles (privateTitles = "redacted" keeps them) are scrubbed with the pre-A9 set.
    title_frags = set(frags)
    frags = {f for f in frags if norm(f) not in pcode}
    modes = dict(terms["match"])
    # Commit ids and branch parts: whole tokens. The stricter substring match of a real name,
    # term or keyword with the same spelling, and explicit match entries, are kept.
    stronger = {x.casefold() for x in names | set(terms["terms"]) | set(cfg["keywords"]) | cfg["privateProjects"]}
    for h in hashes | title_frags:
        if h.casefold() not in stronger:
            modes.setdefault(h.casefold(), "word")
    matcher = Matcher(names | hashes | hosts | frags | set(terms["terms"]) | set(cfg["keywords"])
                      | cfg["privateProjects"], modes)
    title_matcher = Matcher(names | hashes | hosts | title_frags | set(terms["terms"]) | set(cfg["keywords"])
                            | cfg["privateProjects"], modes)

    url_rx = public_url_rx(public_repos, cfg["githubOwners"])
    matcher.url_rx = title_matcher.url_rx = url_rx
    branches = set()
    notes = collections.Counter()           # degradations, counted for the context (no names)
    for e in activity:
        title = e.get("title") if isinstance(e.get("title"), str) else ""
        title = scrub_title(title, matcher if is_public(e, "repo") else title_matcher)
        if is_public(e, "repo"):
            if e.get("source") == "local":       # may live only on a private fork or mirror
                e["branch"] = None
            b = e.get("branch")
            if isinstance(b, str) and b and not matcher.hit(decode(b)) and scrub_title(b, matcher) == b:
                branches.add(b)
            else:
                e["branch"] = None if b is None else _PRIVATE_GROUP_BRANCH
            # A link spells the owner: when that login is an unlisted private branch part (R10), the gate
            # would refuse the page, so the link goes instead.
            if not (isinstance(e.get("url"), str) and url_rx and url_rx.fullmatch(e["url"]) and not matcher.hit(e["url"])):
                if isinstance(e.get("url"), str) and url_rx and url_rx.fullmatch(e["url"]):
                    notes["linksDropped"] += 1
                e["url"] = None
            if not (isinstance(e.get("hash"), str) and re.fullmatch(r"[0-9a-f]{7,40}", e["hash"])):
                e["hash"] = None
            if not is_code(e.get("machine"), cfg):
                e["machine"] = None
        else:
            e.update(public=False, branch=None, hash=None, url=None, machine=None, t=_hour(e["t"]))
            e["repo"] = _PRIVATE_REPO
            if cfg["privateTitles"] == "prefix-only":
                title = prefix_only(title)
        e["title"] = title
        _files_and_author(e, is_public(e, "repo"), matcher, cfg, notes)

    days = [d for d in (src.get("usageDays") if isinstance(src.get("usageDays"), list) else []) if isinstance(d, dict)]
    for holder in [today, *days]:               # today and every day: private projects become one merged row
        rows = holder.get("byProject")
        if not (isinstance(rows, list) and rows):
            continue
        rows = [p for p in rows if isinstance(p, dict)]
        # A public name that spells a private word (say a part of a private branch) would make the gate refuse the
        # whole page: such a row joins the merged private row instead. Judged with the stricter title set and on every
        # layer the gate decodes, so this is never looser than the gate; it may merge a row the gate would have let by.
        shown = lambda p: is_public(p, "project") and not any(title_matcher.hit(t) for t in (p["project"], *gate_layers(p["project"])))
        pub_rows = [p for p in rows if shown(p)]
        priv_rows = [p for p in rows if not shown(p)]
        notes["projectsMerged"] += sum(1 for p in priv_rows if is_public(p, "project"))
        if priv_rows:
            merged = {"project": _PRIVATE_GROUP, "public": False,
                      "requests": sum(p.get("requests") or 0 for p in priv_rows),
                      "costUsd": round(sum(p.get("costUsd") or 0 for p in priv_rows), 2)}
            if holder is not today:
                merged.update(sessions=sum(p.get("sessions") or 0 for p in priv_rows),
                              unpricedRequests=sum(p.get("unpricedRequests") or 0 for p in priv_rows))
            pub_rows.append(merged)
        holder["byProject"] = pub_rows
    for d in days:                              # a machine without a public code is left out of the day
        if isinstance(d.get("byMachine"), list):
            d["byMachine"] = [m for m in d["byMachine"] if isinstance(m, dict) and is_code(m.get("machine"), cfg)]
    for r in src.get("runtimes") or []:                   # odd versions are dropped, not published
        if isinstance(r, dict) and isinstance(r.get("version"), str) and not SEMVER.fullmatch(r["version"]):
            r["version"] = None
    for m in [m for d in [today, *days] for m in d.get("byModel") or [] if isinstance(m, dict)]:
        if not isinstance(m.get("model"), str) or m["model"] not in MODELS:
            m["model"] = "other"
    if "quota" in src:
        src["quota"] = [q for q in src["quota"] or [] if is_code(q.get("account"), cfg)]

    hidden = sorted(set(cfg["hidden"]) | {h for h in src.get("hidden") or [] if h in HIDEABLE})
    for h in hidden:
        if h == "byProject":
            src.setdefault("today", {})["byProject"] = []
            for d in days:
                if "byProject" in d:
                    d["byProject"] = []
        else:
            src[h] = []
    src["hidden"] = hidden
    src["view"] = "public"

    def allowed(g):
        a = set(cfg["allow"].get(g, ()))
        if g in ("activity[].repo", *PROJECT_FIELDS):
            a |= public_repos
        if g == "activity[].branch":
            a |= branches
        return a

    pub = _rebuild(src, "", allowed)
    _no_joined_names(pub, matcher, notes)
    bad = []
    _check(pub, "", cfg, url_rx, bad)
    if bad:
        raise ExportError("export would publish mistyped values:\n  " + "\n  ".join(bad))
    ctx = {"privateNames": sorted(names | hashes | hosts | frags), "publicRepos": sorted(public_repos),
           "publicBranches": sorted(branches),
           "degraded": {k: notes[k] for k in ("filesDropped", "filesJoined", "branchesJoined", "titlesJoined",
                                               "linksDropped", "authorsDropped", "projectsMerged")}}
    return pub, ctx


def _serial(page):
    return json.dumps(page, ensure_ascii=False)


ESCAPABLE = re.compile(r"[&\\%+\"\x00-\x1f]")     # what the gate's decoding or JSON's own escapes act on


def _strings(node, out):
    """Keys and strings in order, as the gate's "decoded values" pass joins them."""
    if isinstance(node, dict):
        for k, v in node.items():
            out.append(str(k))
            _strings(v, out)
    elif isinstance(node, list):
        for v in node:
            _strings(v, out)
    elif isinstance(node, str):
        out.append(node)


# The patterns the gate looks for in every text it reads (backlog A8). Reimplemented, not shared: mirrors
# scripts/verify_public.py PATTERNS (lines 77-91), ABS_URL / REL_URL / XMLNS (99-102) and PROTO_REL (121-123), and
# their use in check_text() (lines 533-549: every layer; an absolute URL is fine when it is an XML namespace or
# a public commit link). The SVG geometry exemption there concerns HTML tags, which page data cannot hold
# ("<" is escaped). tests/test_export.py compares the two on a table of inputs.
GATE_PATTERNS = {
    "email": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}"),
    "ipv4": re.compile(r"(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?!\w|\.\d)"),
    "ipv6": re.compile(r"(?i)(?<![\w:])(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}(?![\w:])"
                       r"|(?<![\w:])(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?(?![\w:])"),
    "path": re.compile(r"(?:/Users/|/home/|/Volumes/|/root/|/private/|/mnt/|/srv/|/var/folders/"
                       r"|(?<![\w~])~/|(?<![A-Za-z])[A-Za-z]:\\{1,2}[\w.$ -]|\\\\[A-Za-z0-9.-]+\\)"),
    "lan host": re.compile(r"(?i)\b[\w-]+(?:\.[\w-]+)*\.(?:ts\.net|home\.arpa)\b"),
    "secret": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"
                         r"|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}"
                         r"|sk-[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{8,}|npm_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}"
                         r"|xox[a-z]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})"
                         r"|\beyJ[\w-]{5,}\.[\w-]{5,}(?:\.[\w-]*)?"
                         r"|(?i:\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*[\"']?[^\s\"'<>{}]{4,})"),
}
GATE_ABS_URL = re.compile(r"\b[A-Za-z][A-Za-z0-9+.-]*://[^\s\"'<>()\\]*")
GATE_REL_URL = re.compile(r"(?i)(?:\b(?:src|href|srcset|action|data|poster|xlink:href)\s*=\s*[\"']?\s*"
                          r"|url\(\s*[\"']?\s*|@import\s+[\"']?\s*|\bimport\s*\(\s*[\"']|\bfetch\s*\(\s*[\"'])//")
GATE_XMLNS = re.compile(r"http://www\.w3\.org/(?:2000/svg|1999/xhtml|1999/xlink|XML/1998/namespace)")
GATE_PROTO_REL = re.compile(r"[\"'`][ \t]*[/\\][ \t]*[/\\][ \t]*[\w-]+(?:\.[\w-]+)+"
                            r"|[(=][/\\][ \t]*[/\\][ \t]*[\w-]+(?:\.[\w-]+)+"
                            r"|\b[A-Za-z][\w+.-]*:\s*(?:\\|/\s+/|/\\)\s*[/\\]?\s*[\w-]+(?:\.[\w-]+)+")


def pattern_hits(text, url_rx=None):
    """What the gate's patterns find in one text, raw layer only: a list of (kind, match), one per match.
    url_rx: the public commit links, which the gate allows."""
    out = [(kind, m.group(0)) for kind, rx in GATE_PATTERNS.items() for m in rx.finditer(text)]
    for m in GATE_ABS_URL.finditer(text):
        u = m.group(0).rstrip(".,;")
        if not (GATE_XMLNS.fullmatch(u) or (url_rx and url_rx.fullmatch(u))):
            out.append(("url", u))
    return out + [("rel", m.group(0)) for rx in (GATE_REL_URL, GATE_PROTO_REL) for m in rx.finditer(text)]


def _entry_patterns(e, url_rx):
    """Pattern hits in one commit as the gate reads it: page JSON as written (--out uses indent=1) and compact as
    inlined in index.html (with its escaping), the joined keys and strings, and every decoded layer of each.
    Patterns stop at quotes, spaces and brackets, so what a title or branch forms stays inside its commit.
    A hit is ("\\0", commit, kind, match, n): numbered per commit, so the same text in a title and in a branch
    are two hits (each value is blamed for its own), and the shape is one no name hit has."""
    vals = []
    _strings(e, vals)
    compact = _serial(e)
    esc = compact.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    out = set()
    for text in dict.fromkeys((compact, esc, json.dumps(e, ensure_ascii=False, indent=1), "\n".join(vals))):
        for layer in [text, *gate_layers(text)]:
            for (kind, m), c in collections.Counter(pattern_hits(layer, url_rx)).items():
                out.update(("\0", id(e), kind, m, i) for i in range(c))
    return out


def _hits(node, matcher):
    """Hits in the forms the gate reads: the page JSON, and the data as hub/page.py html() inlines it in
    index.html ("<" and U+2028 / U+2029 escaped, so "<b12" reads "u003cb12" there). Same escaping as html();
    a test pins the two together. The escaped form is scanned only when it differs.
    The gate also decodes the JSON and the joined keys and strings (backlog A6: "docs: n\\u006fte" + "branch").
    Only a commit whose title or branch holds something to decode can differ there, so only such commits
    (node is the page or one commit) are decoded, each on its own: no extra whole-page scan.
    The gate's patterns (A8: "\\r\\n" in JSON reads as a \\\\host\\ path, '"//a.b' as a protocol-relative URL) are
    looked for per commit, each on its own: also no extra whole-page scan."""
    raw = _serial(node)
    out = matcher.hits(raw)
    if "<" in raw or "\u2028" in raw or "\u2029" in raw:
        esc = raw.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
        out |= matcher.hits(esc)
    acts = node.get("activity") if isinstance(node.get("activity"), list) else [node]
    for e in acts:
        if not isinstance(e, dict):
            continue
        if any(isinstance(e.get(k), str) and ESCAPABLE.search(e[k]) for k in ("title", "branch")):
            vals = []
            _strings(e, vals)
            joined = "\n".join(vals)             # raw too: a literal tab is "\t" in the JSON but no letter here
            out |= matcher.hits(joined)
            for text in (_serial(e), joined):
                for layer in gate_layers(text):
                    out |= matcher.hits(layer)
        out |= _entry_patterns(e, getattr(matcher, "url_rx", None))
    return out


def _no_joined_names(pub, matcher, notes):
    """The gate reads the whole snapshot as one normalised stream, JSON and bundled HTML alike, so text
    joined to the JSON around it can spell a private name no single value holds. A page without any hit
    costs one scan per form (both forms are scanned with every term: an escaped "<" makes new short
    words, so long terms alone would not do). Otherwise file lists, then branches, then titles are degraded."""
    if not _hits(pub, matcher):
        return
    _joined_files(pub, matcher, notes)
    _joined_branches(pub, matcher, notes)
    _joined_titles(pub, matcher, notes)


def _blame(pub, acts, levels, matcher, notes, key):
    """Degrade entries one level at a time (levels[id] lists the values from shown to most degraded) until
    the page shows no hit beyond its base, the hits left with every entry at its last level: those are not
    these entries' doing and are left to the next pass and the gate (it refuses; nothing leaks). First each
    entry whose own text shows such a hit, located per entry (about one page of extra scanning), goes to the
    first level that leaves it clean ("perf: ---" skips its prefix, which joins the same way), else to the
    deepest level that removes one; then, if hits remain, entries go down one step at a time in page order,
    one page scan per step. Each step is final and an entry has at most len(levels) - 1, so this ends.
    notes[key] counts entries degraded."""
    if not acts:
        return
    field = {"titlesJoined": "title", "branchesJoined": "branch"}[key]
    at = {id(a): 0 for a in acts}

    def put(a, i):
        at[id(a)] = i
        a[field] = levels[id(a)][i]

    for a in acts:
        put(a, len(levels[id(a)]) - 1)
    base = _hits(pub, matcher)
    for a in acts:
        put(a, 0)
    if not (_hits(pub, matcher) - base):
        return
    done = set()
    for a in acts:                    # the first level that leaves the entry clean, else the deepest that helps
        shown, best = _hits(a, matcher), 0
        for i in range(1, len(levels[id(a)])):
            put(a, i)
            h = _hits(a, matcher)
            if (shown - h) - base:
                best = i
                if not (h - base):
                    break
        put(a, best)
        if best:
            done.add(id(a))
    left = _hits(pub, matcher) - base           # one page scan; then one per step taken, none per entry
    for a in acts:
        if not left:
            break
        while left and at[id(a)] < len(levels[id(a)]) - 1:
            put(a, at[id(a)] + 1)
            done.add(id(a))
            left = _hits(pub, matcher) - base
    notes[key] += len(done)


def _joined_branches(pub, matcher, notes):
    """A public commit's branch joined to the JSON around it ("feat/wild" + the next key "hash"): that one
    branch becomes null (backlog A6), as a private commit's is."""
    acts = [a for a in pub.get("activity") or [] if isinstance(a, dict) and isinstance(a.get("branch"), str)]
    _blame(pub, acts, {id(a): [a["branch"], None] for a in acts}, matcher, notes, "branchesJoined")


def _joined_files(pub, matcher, notes):
    """A path joined to the JSON around it ("p": "ixel-forge/..." after ..."p", or one file into the next).
    Hits not already there without any file list are blamed on the lists: first every commit whose
    own list causes a new hit loses it, then lists go one commit at a time until no new hit is left.
    Hits present without any list are not the lists' doing and are left to the next pass and the gate."""
    acts = [a for a in pub.get("activity") or [] if isinstance(a, dict) and a.get("files")]
    if not acts:
        return
    lists = {id(a): a["files"] for a in acts}
    order = {id(a): list(a) for a in acts}              # key order decides what sits next to what

    def hits_with(keep):
        for a in acts:
            items = [(k, lists[id(a)] if k == "files" else a[k]) for k in order[id(a)] if k != "files" or id(a) in keep]
            a.clear()
            a.update(items)
        return _hits(pub, matcher)

    base = hits_with(set())
    keep = {id(a) for a in acts}
    if not (hits_with(keep) - base):
        return
    for a in acts:
        if hits_with({id(a)}) - base:
            keep.discard(id(a))
            notes["filesJoined"] += 1
    for a in acts:
        if not (hits_with(keep) - base):
            break
        if id(a) in keep:
            keep.discard(id(a))
            notes["filesJoined"] += 1
    hits_with(keep)


def _joined_titles(pub, matcher, notes):
    """A title joined to the JSON around it ("docs: note" + the next key "branch"; "<b12" escaped in
    index.html; "docs: n\\u006fte" decoded) is cut to its prefix (backlog A5); a prefix that still joins
    ("perf:" + "branch") is masked to ****** (A6), the masked form CONTRACT §3 allows any title. Private
    titles that are only a prefix already can be masked too."""
    acts = [a for a in pub.get("activity") or [] if isinstance(a, dict) and isinstance(a.get("title"), str)
            and a["title"] != RED]
    levels = {id(a): list(dict.fromkeys([a["title"], prefix_only(a["title"]), RED])) for a in acts}
    _blame(pub, acts, levels, matcher, notes, "titlesJoined")


def _files_and_author(e, public, matcher, cfg, notes):
    """S17 R09. nFiles: a count or null. files: only for a public, pushed GitHub commit whose
    published paths are all clean, else dropped for this commit alone (never an export error).
    author: a configured login on a public commit that hits no private word, else null."""
    n = e.get("nFiles")
    n = n if isinstance(n, int) and not isinstance(n, bool) and n >= 0 else None
    files = e.get("files")
    shown = files[:FILES_MAX] if isinstance(files, list) else []
    if (public and e.get("pushed") is True and e.get("source") == "github" and shown
            and all(isinstance(f, dict) and f.get("s") in FILE_STATUS and clean_path(f.get("p"), matcher) for f in shown)):
        e["files"] = [{"s": f["s"], "p": f["p"]} for f in shown]
        n = max(n or 0, len(files))
    else:
        if public and e.get("pushed") is True and e.get("source") == "github" and shown:
            notes["filesDropped"] += 1
        e["files"] = None
    e["nFiles"] = n
    a = e.get("author")
    if public and isinstance(a, str) and a in cfg["authors"] and matcher.hit(a):
        notes["authorsDropped"] += 1
    e["author"] = a if (public and isinstance(a, str) and a in cfg["authors"] and LOGIN.fullmatch(a)
                        and not matcher.hit(a)) else None


_PRIVATE_REPO = object()          # rebuilt as {"masked": true}: not a str, never on an allowlist
_PRIVATE_GROUP_BRANCH = object()  # same, for a public commit's branch that carries a private name


def main(argv=None):
    """Every failure is a one-line message without values and exit 2; no traceback (review L5)."""
    try:
        return _main(argv)
    except SystemExit:
        raise
    except Exception as e:                                    # noqa: BLE001
        print(f"export failed ({e.__class__.__name__}); nothing was written", file=sys.stderr)
        return 2


def _main(argv=None):
    ap = argparse.ArgumentParser(prog="hub.export")
    ap.add_argument("private")
    ap.add_argument("--config", default=str(DEFAULT_CONFIG))
    ap.add_argument("--no-config", action="store_true", help="strictest settings; fabricated examples only")
    ap.add_argument("--terms", default=str(DEFAULT_TERMS))
    ap.add_argument("--out", default=str(ROOT / "out" / "page.public.json"))
    ap.add_argument("--context")
    ap.add_argument("--site", help="also write DIR/index.html = hub.bundle.bundle(public page); DIR must be "
                                    "new or empty, so the gate sees exactly what is published")
    a = ap.parse_args(argv)
    try:
        page = json.loads(Path(a.private).read_text(encoding="utf-8"), parse_constant=_no_constant)
        terms = load_terms(a.terms)
        pub, ctx = export(page, load_config(None if a.no_config else a.config, terms), terms)
    except ExportError as e:                      # our own messages carry no private values
        print(f"export failed: {e}", file=sys.stderr)
        return 2
    except (OSError, ValueError) as e:
        print(f"export failed ({e.__class__.__name__})", file=sys.stderr)
        return 2
    site = Path(a.site) if a.site else None
    if site and site.exists() and any(site.iterdir()):
        print("export failed: --site directory is not empty", file=sys.stderr)
        return 2
    for path, obj in ((a.out, pub), (a.context, ctx)):
        if path:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            Path(path).write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if site:
        from .bundle import bundle                    # lane D's single-file page
        site.mkdir(parents=True, exist_ok=True)
        (site / "index.html").write_text(bundle(pub), encoding="utf-8")
    if any(ctx["degraded"].values()):              # counts only: misconfiguration shows without names
        print("export degraded (counts): " + ", ".join(f"{k} {v}" for k, v in ctx["degraded"].items() if v), file=sys.stderr)
    print(f"wrote {a.out}" + (f" and {site}/index.html" if site else "")
          + (f" and the context {a.context} (private: keep it out of git)" if a.context else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
