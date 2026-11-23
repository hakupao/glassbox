#!/usr/bin/env python3
"""Local check (backlog A7): would the publish gate refuse the shipped web/ code because of a private word?

The gate (scripts/verify_public.py) checks private words against the whole bundled page, web/ code included. An edit
to web/ that happens to contain one stops every publish (fail closed, no leak). This runs the gate's own matcher
(vp.Gate.name_hits, imported, not reimplemented) over the files the bundle inlines, with the real word list, the real
config and a cached private page for the derived names (repos, commit ids, telling branch parts).

The verdict comes from the whole document the gate would see: web/index.html with every referenced .css / .js
inlined the way hub.page.bundle() does it (`<style>\n...</style>`, `<script>\n...</script>`, assembled here with the
bundler's own tag patterns, without importing hub), so a word formed by a tag name and a file's first or last word,
or across two inlined files, is found too. Rules mirrored from verify_public.py (Gate._check_one):
- strong words over the whole document, raw and every vp.decodings() layer (check_text(..., weak=not is_html));
- weak words (private branch parts) only outside verbatim web code (Gate._without_web_code, then `name_hits(t) &
  self.weak`, the "outside web/ code" pass).
Per-file passes only place a hit: `web/<file>:<line>`, a span `<a>-<b>` across lines, or `web/index.html:?` when only
the assembled document has it (tag joins, file joins).
Limits: the data script is a stand-in (`window.GB = {};`), so a word formed with real page data next to it is not
seen; only private words are checked, not the gate's other patterns (URLs, addresses: see scripts/check_web.py).

    python3 scripts/check_web_terms.py [--refresh | --try-refresh SECONDS] [--source URL] [--web DIR] [--page FILE]
        [--terms .local/redact_terms.local.json] [--config .local/public.local.toml]

The private page is cached at .local/gate/page.private.json (git-ignored, mode 0600). --refresh fetches it from
--source, else $GLASSBOX_GATE_SOURCE, else hub_url in ~/.glassbox/probe.toml + /page.json. Without a cache only the
word list is checked (one notice line). --try-refresh: refresh with that deadline, and on any failure say so in
one line and use the cache (the pre-commit hook). The cache's age is printed, with a warning above 7 days.
Output: `web/<file>:<line> term #<ordinal>` per hit (the gate's ordinals); never a word or the matched text.
Exit status: 0 clean, 1 hits, 2 setup error (one line, no traceback).
"""
import argparse
import copy
import json
import os
import re
import sys
import tempfile
import threading
import time
import tomllib
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import verify_public as vp  # noqa: E402

ROOT = vp.ROOT
CACHE = ROOT / ".local" / "gate" / "page.private.json"
TIMEOUT = 15                                   # seconds, whole fetch
STALE_DAYS = 7
# hub/page.py's _LINK / _SCRIPT / MARKER, the tags bundle() replaces (mirrored, not imported: the check stays apart
# from hub code); verify_public.web_bodies() line 328 is the regex for which files index.html references.
LINK = re.compile(r'<link rel="stylesheet" href="([a-z0-9-]+\.css)">')
SCRIPT = re.compile(r'<script src="([a-z0-9-]+\.js)"></script>')
MARKER = '<script id="gb-data"></script>'
REFERENCED = re.compile(r'<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"/:]+\.(?:js|css))"')


class SetupError(Exception):
    pass


def source_url(arg):
    if arg:
        return arg
    if os.environ.get("GLASSBOX_GATE_SOURCE"):
        return os.environ["GLASSBOX_GATE_SOURCE"]
    probe = Path.home() / ".glassbox" / "probe.toml"
    try:
        hub = tomllib.loads(probe.read_text(encoding="utf-8")).get("hub_url")
    except (OSError, ValueError):
        hub = None
    if not isinstance(hub, str) or not hub:
        raise SetupError("no source: pass --source, set GLASSBOX_GATE_SOURCE or hub_url in ~/.glassbox/probe.toml")
    return hub.rstrip("/") + "/page.json"


def refresh(url, cache, timeout=TIMEOUT):
    """Fetch the private page with a hard deadline; replace the cache atomically (0600) only when it is a page/1."""
    box = {}

    def get():
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                box["body"] = r.read()
        except Exception as e:                                # noqa: BLE001 — reported by class name only
            box["error"] = e.__class__.__name__

    t = threading.Thread(target=get, daemon=True)
    t.start()
    t.join(timeout)
    if t.is_alive():
        raise SetupError(f"cannot fetch the private page (timeout after {timeout:g} s)")
    if "error" in box:
        raise SetupError(f"cannot fetch the private page ({box['error']})")
    try:
        page = vp.strict_json(box["body"].decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise SetupError("the source did not return JSON") from None
    if not isinstance(page, dict) or page.get("schema") != "glassbox.page/1":
        raise SetupError("the source is not a glassbox.page/1 page")
    cache.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=cache.parent, prefix=".page.", suffix=".tmp")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(box["body"])
        os.replace(tmp, cache)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def shipped_files(web):
    """(document, files): the assembled page the gate would check and [(name, text)] for placing hits — index.html
    with the replaced tags emptied (on the same line) and every file it references, in order."""
    index = web / "index.html"
    if not index.is_file():
        raise SetupError(f"{web.name}/index.html not found")
    bodies = vp.web_bodies(web)                       # raises vp.SetupError on a symbolic link
    template = index.read_text(encoding="utf-8")
    names = list(dict.fromkeys(REFERENCED.findall(template)))
    files = []
    for n in names:
        f = web / n
        text = f.read_text(encoding="utf-8") if f.is_file() else None
        if text is None or "\n" + text not in bodies:
            raise SetupError(f"web/: a file index.html references is missing or not inlined (#{names.index(n) + 1})")
        files.append((n, text))
    texts = dict(files)
    doc = LINK.sub(lambda m: f"<style>\n{texts[m.group(1)]}</style>", template)
    doc = SCRIPT.sub(lambda m: f"<script>\n{texts[m.group(1)]}</script>", doc)
    if doc.count(MARKER) != 1 or REFERENCED.search(doc):
        raise SetupError("web/index.html: a referenced file is not in the form the bundler inlines")
    doc = doc.replace(MARKER, "<script>window.GB = {};</script>")
    markup = SCRIPT.sub("<script></script>", LINK.sub("<style></style>", template)).replace(MARKER, "<script></script>")
    return doc, [("index.html", markup)] + files


def hits(gate, text, weak):
    """The gate's verdict on one file: ordinals over the raw text and every decoding layer (as Gate.check_text)."""
    found = set()
    for t in [text] + vp.decodings(text):
        found |= gate.name_hits(t, weak)
    return found


def only(gate, i):
    """The gate restricted to term #i (placing a hit only; the verdict uses the full gate)."""
    one = copy.copy(gate)
    one.matchers = [m for m in gate.matchers if m[0] == i]
    return one


def locate(one, text, weak):
    """Lines of term #i, for the report only (the verdict comes from the whole file). A hit that no single line
    reproduces (it spans lines) is given as the first-last line of the shortest span that does."""
    lines = text.split("\n")
    single = [str(n) for n, line in enumerate(lines, 1) if hits(one, line, weak)]
    if single:
        return single
    for width in (2, 3, 5, 10, 50):
        for n in range(len(lines) - width + 1):
            if hits(one, "\n".join(lines[n:n + width]), weak):
                return [f"{n + 1}-{n + width}"]
    return ["?"]


def main(argv=None):
    """Every failure is a one-line message and exit 2; no traceback (an exception text could carry a word)."""
    try:
        return _main(argv)
    except SystemExit:
        raise
    except (SetupError, vp.SetupError) as e:
        print(f"check_web_terms: setup error: {e}", file=sys.stderr)
        return 2
    except Exception as e:                                    # noqa: BLE001
        print(f"check_web_terms: error ({e.__class__.__name__}); nothing was checked", file=sys.stderr)
        return 2


def _main(argv):
    ap = argparse.ArgumentParser(prog="check_web_terms")
    ap.add_argument("--web", default=str(vp.WEB_DIR))
    ap.add_argument("--terms", default=str(ROOT / ".local" / "redact_terms.local.json"))
    ap.add_argument("--config", default=str(ROOT / ".local" / "public.local.toml"))
    ap.add_argument("--page", default=str(CACHE), help="cached private page/1 (derived names)")
    r = ap.add_mutually_exclusive_group()
    r.add_argument("--refresh", action="store_true", help="fetch the private page into --page first")
    r.add_argument("--try-refresh", type=float, metavar="SECONDS", help="refresh within SECONDS; on failure use the cache")
    ap.add_argument("--source", help="private page URL for --refresh")
    a = ap.parse_args(argv)
    web, page_path = Path(a.web).expanduser(), Path(a.page).expanduser()
    terms = vp.load_json(a.terms, "terms file")
    config = vp.load_toml(a.config)
    if a.refresh:
        refresh(source_url(a.source), page_path)
    elif a.try_refresh is not None:
        try:
            refresh(source_url(a.source), page_path, a.try_refresh)
        except SetupError as e:
            print(f"check_web_terms: refresh failed ({e}); using the cache")
        except OSError as e:    # writing the cache failed (read-only dir, full disk): class name only
            print(f"check_web_terms: refresh failed ({type(e).__name__}); using the cache")
    private = None
    if page_path.is_file():
        private = vp.load_json(page_path, "private page")
        if not isinstance(private, dict) or private.get("schema") != "glassbox.page/1":
            raise SetupError("cached private page is not a glassbox.page/1 page")
        days = int(max(0, time.time() - page_path.stat().st_mtime) // 86400)
        print(f"check_web_terms: private page cached {days} day(s) ago"
              + (f"; WARNING: older than {STALE_DAYS} days, run with --refresh" if days > STALE_DAYS else ""))
    else:
        print("check_web_terms: no cached private page (run with --refresh): word list only, derived names unchecked")
    doc, files = shipped_files(web)
    orig = vp.WEB_DIR
    vp.WEB_DIR = web
    try:
        gate = vp.Gate(terms, private, config)
    finally:
        vp.WEB_DIR = orig
    rest = gate._without_web_code(doc)
    found = hits(gate, doc, False) | (hits(gate, doc if rest is None else rest, True) & gate.weak)
    for i in sorted(found):
        placed, one = False, only(gate, i)
        for name, text in files:
            weak = name == "index.html"              # markup: weak words count; inlined code: strong only
            if hits(one, text, weak):
                placed = True
                for line in locate(one, text, weak):
                    print(f"web/{name}:{line} term #{i}")
        if not placed:
            print(f"web/index.html:? term #{i}")
    total = len(found)
    print(f"check_web_terms: {len(files)} file(s), {'%d hit(s): the publish gate would refuse this web/' % total if total else 'clean'}")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
