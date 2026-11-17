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
- today.byProject merges private projects into one {"masked": true, "group": "private"} row.
- Quota rows without an account code are dropped; unknown models become "other".
- Hidden blocks are [] (rule 7); today.hourly is not in the table, so it never appears.

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
import copy
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


class ExportError(Exception):
    pass


def _no_constant(name):
    raise ValueError("NaN / Infinity")                    # review L6


# --- config ----------------------------------------------------------------------------------

CONFIG_KEYS = {"privateTitles", "hidden", "keywords", "privateProjects", "codes", "githubOwners", "allow"}
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
    }
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


class Matcher:
    """CONTRACT §3 rule 6. Long terms (5+ after norm) or non-Latin ones: substring of norm(text).
    Short terms: a run of whole tokens. `modes` maps a casefolded term to "substring" or "word"."""

    def __init__(self, names, modes):
        self.long, self.short = set(), []
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


def scrub_title(title, matcher):
    """A title that mentions a private name is cut to its prefix (review L9); then regexes."""
    t = decode(title)
    if matcher.hit(t):
        t = prefix_only(t)
        if matcher.hit(t):
            t = RED
    for rx in SCRUB:
        t = rx.sub(RED, t)
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
    }[kind]()


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
    texts = []
    _walk_text(src, "", texts)
    names = {v for g, v in texts if g not in NAME_FIELDS_SKIP and v not in cfg["allow"].get(g, ())
             and not (g in ("activity[].repo", "today.byProject[].project") and v in public_repos)}
    names |= {e[k] for e, k in visibility_sites(src) if isinstance(e.get(k), str) and not is_public(e, k)}
    private_keys = {k for k, v in verdict.items() if not v}
    allow_all = {a for a in allow_all if norm(a) not in private_keys}
    # Codes (A, K, ...) are public by design; a label that equals its code reveals nothing.
    hashes, hosts, frags = set(), set(), set()
    clash = {c for c in cfg["codes"] if c in names}
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
    frags = {f for f in frags if norm(f) not in VOCAB and f not in allow_all and not is_code(f, cfg)}
    modes = dict(terms["match"])
    # Commit ids and branch parts: whole tokens. The stricter substring match of a real name,
    # term or keyword with the same spelling, and explicit match entries, are kept.
    stronger = {x.casefold() for x in names | set(terms["terms"]) | set(cfg["keywords"])}
    for h in hashes | frags:
        if h.casefold() not in stronger:
            modes.setdefault(h.casefold(), "word")
    matcher = Matcher(names | hashes | hosts | frags | set(terms["terms"]) | set(cfg["keywords"]), modes)

    url_rx = public_url_rx(public_repos, cfg["githubOwners"])
    branches = set()
    for e in activity:
        title = e.get("title") if isinstance(e.get("title"), str) else ""
        title = scrub_title(title, matcher)
        if is_public(e, "repo"):
            if e.get("source") == "local":       # may live only on a private fork or mirror
                e["branch"] = None
            b = e.get("branch")
            if isinstance(b, str) and b and not matcher.hit(decode(b)) and scrub_title(b, matcher) == b:
                branches.add(b)
            else:
                e["branch"] = None if b is None else _PRIVATE_GROUP_BRANCH
            if not (isinstance(e.get("url"), str) and url_rx and url_rx.fullmatch(e["url"])):
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

    if by_project:
        pub_rows = [p for p in by_project if is_public(p, "project")]
        priv_rows = [p for p in by_project if not is_public(p, "project")]
        if priv_rows:
            pub_rows.append({"project": _PRIVATE_GROUP, "public": False,
                             "requests": sum(p.get("requests") or 0 for p in priv_rows),
                             "costUsd": round(sum(p.get("costUsd") or 0 for p in priv_rows), 2)})
        today["byProject"] = pub_rows
    for r in src.get("runtimes") or []:                   # odd versions are dropped, not published
        if isinstance(r, dict) and isinstance(r.get("version"), str) and not SEMVER.fullmatch(r["version"]):
            r["version"] = None
    for m in today.get("byModel") or []:
        if m.get("model") not in MODELS:
            m["model"] = "other"
    if "quota" in src:
        src["quota"] = [q for q in src["quota"] or [] if is_code(q.get("account"), cfg)]

    hidden = sorted(set(cfg["hidden"]) | {h for h in src.get("hidden") or [] if h in HIDEABLE})
    for h in hidden:
        if h == "byProject":
            src.setdefault("today", {})["byProject"] = []
        else:
            src[h] = []
    src["hidden"] = hidden
    src["view"] = "public"

    def allowed(g):
        a = set(cfg["allow"].get(g, ()))
        if g in ("activity[].repo", "today.byProject[].project"):
            a |= public_repos
        if g == "activity[].branch":
            a |= branches
        return a

    pub = _rebuild(src, "", allowed)
    bad = []
    _check(pub, "", cfg, url_rx, bad)
    if bad:
        raise ExportError("export would publish mistyped values:\n  " + "\n  ".join(bad))
    ctx = {"privateNames": sorted(names | hashes | hosts | frags), "publicRepos": sorted(public_repos),
           "publicBranches": sorted(branches)}
    return pub, ctx


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
    print(f"wrote {a.out}" + (f" and {site}/index.html" if site else "")
          + (f" and the context {a.context} (private: keep it out of git)" if a.context else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
