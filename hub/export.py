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
  `falcon_ledger` both go). `privateTitles = "prefix-only"` keeps only `fix:` for private ones.
- today.byProject merges private projects into one {"masked": true, "group": "private"} row.
- Quota rows without an account code are dropped; unknown models become "other".
- Hidden blocks are [] (rule 7); today.hourly is not in the table, so it never appears.

export() also returns a gate context (private names, public repos and branches) for
scripts/verify_public.py. It holds real names: write it only under a gitignored path.

    python -m hub.export PRIVATE.json [--config .local/public.local.toml]
        [--terms .local/redact_terms.local.json] [--out out/page.public.json]
        [--context .cache/gate-context.json]

Config format: docs/public.example.toml. A missing config file means empty allowlists.
"""
import argparse
import copy
import json
import re
import sys
import tomllib
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
NAME_FIELDS_SKIP = {"activity[].branch"}     # branches are not names; private ones are nulled anyway

# Title scrubbing, applied in this order. The gate has its own, independent set.
SCRUB = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}"
               r"|sk-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})"),
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


# --- config ----------------------------------------------------------------------------------

def load_config(path=DEFAULT_CONFIG):
    p = Path(path).expanduser()
    raw = tomllib.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    cfg = {
        "privateTitles": raw.get("privateTitles", "redacted"),
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
    return cfg


def load_terms(path=DEFAULT_TERMS):
    """{"terms": [...], "allow": [...], "match": {term: "substring"|"word"}}. Missing file is an error."""
    data = json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    allow = {a.casefold() for a in data.get("allow", [])}
    return {"terms": [t for t in data.get("terms", []) if t and t.casefold() not in allow],
            "match": {k.casefold(): v for k, v in data.get("match", {}).items()}}


# --- name matching (CONTRACT §3 rule 6) --------------------------------------------------------

def norm(s):
    return re.sub(r"[-_.\s]", "", s).casefold()


def _vocabulary():
    """Words the public page is made of: enum / const values and keys. A private name equal to
    one of them reveals nothing and would otherwise block every export (e.g. p_other's "other")."""
    words = {"other", "masked", "group", "private", "public"}
    for path, typ in FIELDS.items():
        words.update(k for k in re.split(r"[.\[\]]+", path) if k)
        kind, _, arg = typ.rstrip("?").partition(":")
        if kind in ("enum", "const"):
            words.update(arg.split("|"))
            words.update(w for v in arg.split("|") for w in re.split(r"[^A-Za-z0-9-]+", v) if w)
    return {norm(w) for w in words}


VOCAB = _vocabulary()


def find_spans(text, term, mode=None):
    """Raw-text spans where `term` occurs: normalised substring for long terms, word boundary
    for short ones (CONTRACT §3 rule 6); `mode` overrides."""
    n = norm(term)
    if not n:
        return []
    mode = mode or ("substring" if len(n) >= 5 else "word")
    if mode == "word":
        rx = re.compile(r"(?<![A-Za-z0-9_])" + re.escape(term) + r"(?![A-Za-z0-9_])", re.I)
        return [m.span() for m in rx.finditer(text)]
    chars, idx = [], []
    for i, c in enumerate(text):
        if c in "-_." or c.isspace():
            continue
        for f in c.casefold():
            chars.append(f)
            idx.append(i)
    flat, spans, start = "".join(chars), [], 0
    while (k := flat.find(n, start)) >= 0:
        spans.append((idx[k], idx[k + len(n) - 1] + 1))
        start = k + 1
    return spans


def redact_names(text, names, modes):
    spans = sorted(s for t in names for s in find_spans(text, t, modes.get(t.casefold())))
    if not spans:
        return text
    out, pos = [], 0
    for a, b in spans:
        if b <= pos:
            continue
        a = max(a, pos)
        out.append(text[pos:a] + RED)
        pos = b
    out.append(text[pos:])
    return "".join(out)


def scrub_title(title, names, modes):
    t = redact_names(title, names, modes)
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
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    if kind == "bool":
        return isinstance(v, bool)
    if kind == "null":
        return v is None
    if kind == "text":
        return v in (MASK, MASK_PRIVATE) or isinstance(v, str)
    if not isinstance(v, str):
        return False
    if kind == "iso":
        return _is_iso(v)
    return {
        "date": lambda: bool(re.fullmatch(r"\d{4}-\d\d-\d\d", v)),
        "hash": lambda: bool(re.fullmatch(r"[0-9a-f]{7,40}", v)),
        "semver": lambda: bool(re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", v)),
        "enum": lambda: v in arg.split("|"),
        "const": lambda: v == arg,
        "code": lambda: is_code(v, cfg),
        "model": lambda: v in MODELS or v == "other",
        "url": lambda: bool(url_rx and url_rx.fullmatch(v)),
        "title": lambda: True,
    }[kind]()


def _check(node, path, cfg, url_rx, bad):
    if isinstance(node, dict) and node not in (MASK, MASK_PRIVATE):
        for k, v in node.items():
            _check(v, f"{path}.{k}" if path else k, cfg, url_rx, bad)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            _check(v, f"{path}[{i}]", cfg, url_rx, bad)
    elif not _type_ok(node, FIELDS[generic(path)], cfg, url_rx):
        bad.append(f"{path}: not {FIELDS[generic(path)]} (a {type(node).__name__})")


# --- export ------------------------------------------------------------------------------------

def is_code(v, cfg):
    return isinstance(v, str) and (bool(re.fullmatch(r"[A-Z]", v)) or v in cfg["codes"])


def _hour(t):
    dt = datetime.fromisoformat(t).replace(minute=0, second=0, microsecond=0)
    s = dt.isoformat(timespec="seconds")
    return s[:-6] + "Z" if t.endswith("Z") and s.endswith("+00:00") else s


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
    priv_proj = cfg["privateProjects"]

    def is_public(e, key):
        return (e.get("public") is True and isinstance(e.get(key), str) and e[key] not in priv_proj
                and e.get("source") != "gitea")

    public_repos = {e["repo"] for e in activity if is_public(e, "repo")} | \
                   {p["project"] for p in by_project if is_public(p, "project")}
    allow_all = set().union(*cfg["allow"].values()) | public_repos

    # Private names: every text value that will not be shown, and private repos / projects.
    texts = []
    _walk_text(src, "", texts)
    names = {v for g, v in texts if g not in NAME_FIELDS_SKIP and v not in cfg["allow"].get(g, ())
             and not (g in ("activity[].repo", "today.byProject[].project") and v in public_repos)}
    names |= {e["repo"] for e in activity if isinstance(e.get("repo"), str) and not is_public(e, "repo")}
    names |= {p["project"] for p in by_project if isinstance(p.get("project"), str) and not is_public(p, "project")}
    # Codes (A, K, ...) are public by design; a label that equals its code reveals nothing.
    names = {n for n in names if norm(n) and norm(n) not in VOCAB and n not in allow_all and not is_code(n, cfg)}
    scrub_names = sorted(names | set(terms["terms"]) | set(cfg["keywords"]), key=len, reverse=True)
    modes = terms["match"]

    url_rx = public_url_rx(public_repos, cfg["githubOwners"])
    branches, extra = set(), set()
    for e in activity:
        title = e.get("title") if isinstance(e.get("title"), str) else ""
        title = scrub_title(title, scrub_names, modes)
        if is_public(e, "repo"):
            if e.get("source") == "local":       # may live only on a private fork or mirror
                e["branch"] = None
            b = e.get("branch")
            if isinstance(b, str) and b and scrub_title(b, scrub_names, modes) == b:
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
            for k in ("hash", "url"):
                if isinstance(e.get(k), str):
                    extra.add(e[k] if k == "hash" else re.sub(r"^\w+://([^/]+).*", r"\1", e[k]))
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
    ctx = {"privateNames": sorted(names | extra), "publicRepos": sorted(public_repos),
           "publicBranches": sorted(branches)}
    return pub, ctx


_PRIVATE_REPO = object()          # rebuilt as {"masked": true}: not a str, never on an allowlist
_PRIVATE_GROUP_BRANCH = object()  # same, for a public commit's branch that carries a private name


def main(argv=None):
    ap = argparse.ArgumentParser(prog="hub.export")
    ap.add_argument("private")
    ap.add_argument("--config", default=str(DEFAULT_CONFIG))
    ap.add_argument("--terms", default=str(DEFAULT_TERMS))
    ap.add_argument("--out", default=str(ROOT / "out" / "page.public.json"))
    ap.add_argument("--context", default=str(ROOT / ".cache" / "gate-context.json"))
    a = ap.parse_args(argv)
    try:
        page = json.loads(Path(a.private).read_text(encoding="utf-8"))
        pub, ctx = export(page, load_config(a.config), load_terms(a.terms))
    except (OSError, ValueError, ExportError) as e:
        print(f"export failed: {e}", file=sys.stderr)
        return 2
    for path, obj in ((a.out, pub), (a.context, ctx)):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {a.out} and the gate context {a.context} (private: keep it out of git)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
