#!/usr/bin/env python3
"""Static checks for the front end in web/.

    python3 scripts/check_web.py        # exit 0 when clean, 1 with a list of problems

i18n (S10c):
  - zh / ja / en in web/i18n.js have exactly the same keys, and each key the same {placeholders};
  - every key the code uses exists (string literals in the scripts, data-i18n* in index.html;
    a literal ending in "." followed by "+" or passed to G.lbl is a prefix and needs >= 1 key);
  - every dictionary key is used;
  - no CJK / kana / Hangul / full-width text outside web/i18n.js, so interface text cannot be
    hard-coded around the dictionary;
  - index.html has no bare text nodes (digits and punctuation aside) and no literal title / aria-label / placeholder attributes.
Self-contained page (PLAN §3, S12; the publish gate's rules): in web/ sources no "://" or "//"
(absolute or protocol-relative URLs), no CSS url() or @import, no a.b.c.d numbers, no
"token:" / "password=" followed by a value, and no writes to window.GB. bundle_problems() applies
the same rules (plus e-mail- and path-shaped text) to a bundled page (hub.page.bundle) outside its data script, and checks the CSP
meta comes first, nothing is loaded by src / link, and the data is one strict-JSON script.
"""
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"
I18N = WEB / "i18n.js"
LANGS = ("zh", "ja", "en")
WIDE = re.compile(r"[　-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]")
KEYLIKE = re.compile(r"^[a-z][A-Za-z]*(?:\.[A-Za-z0-9-]+)+$")
LITERAL = re.compile(r"'((?:[^'\\\n]|\\.)*)'")
PREFIX = re.compile(r"'([a-z][A-Za-z]*(?:\.[A-Za-z0-9-]+)*\.)'\s*(?:\+|,)")


FOUR = re.compile(r"(?<![\d.])\d+\.\d+\.\d+\.\d+(?![\d.])")
EMAILISH = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
PATHISH = re.compile(r"/Users/|/home/|/private/|/Volumes/|~/|[A-Za-z]:\\(?=[A-Za-z])")
SECRETISH = re.compile(r"(?:token\s*:|password\s*=)\s*\S{4,}", re.I)
GB_WRITE = re.compile(r"\bGB\s*(?:\.\s*\w+\s*|\[[^\]]*\]\s*)(?:[-+*/]?=(?!=)|\+\+|--)|\bwindow\s*\.\s*GB\s*=(?!=)|globalThis\s*\.\s*GB\b")


def code_problems(name, src):
    """URL, number, secret-shaped and GB-write rules for one source text."""
    out = []
    for n, line in enumerate(src.splitlines(), 1):
        if "//" in line:
            out.append(f"{name}:{n}: '//' (absolute or protocol-relative URL)")
        if re.search(r"url\(|@import", line, re.I):
            out.append(f"{name}:{n}: url() / @import")
        if FOUR.search(line):
            out.append(f"{name}:{n}: a.b.c.d number")
        if EMAILISH.search(line):
            out.append(f"{name}:{n}: e-mail-shaped text")
        if PATHISH.search(line):
            out.append(f"{name}:{n}: file-path-shaped text")
        if SECRETISH.search(line):
            out.append(f"{name}:{n}: 'token:' / 'password=' with a value")
        if GB_WRITE.search(line):
            out.append(f"{name}:{n}: write to window.GB")
    return out


def bundle_problems(doc, page):
    """Checks on a bundled document (hub.page.bundle) for the given page data."""
    from hub.page import CSP
    out = []
    head = doc.split("<head>", 1)[1].lstrip() if "<head>" in doc else ""
    if not head.startswith(CSP):
        out.append("bundle: CSP meta is not the first element of <head>")
    if re.search(r"<script\b[^>]*\bsrc=", doc, re.I) or doc.replace('<link rel="icon" href="data:,">', "").lower().count("<link"):
        out.append("bundle: loads a file (script src / link)")
    data = re.findall(r"<script>window\.GB = (.*?);</script>", doc, re.S)
    if len(data) != 1:
        out.append(f"bundle: {len(data)} window.GB scripts (want 1)")
    else:
        try:
            if json.loads(data[0], parse_constant=lambda c: (_ for _ in ()).throw(ValueError(c))) != page:
                out.append("bundle: embedded data differs from the input")
        except ValueError as e:
            out.append(f"bundle: embedded data is not strict JSON ({e})")
    rest = re.sub(r"<script>window\.GB = .*?;</script>", "", doc, flags=re.S)
    rest = rest.replace(CSP, "")
    out += code_problems("bundle", rest)
    return out


def load_dict(path=I18N):
    text = path.read_text(encoding="utf-8")
    start = text.index("window.GLASSBOX_I18N = ") + len("window.GLASSBOX_I18N = ")
    body = text[start:].rstrip().rstrip(";")
    return json.loads(body)


def placeholders(s):
    return set(re.findall(r"\{(\w+)\}", s))


class _Html(HTMLParser):
    def __init__(self):
        super().__init__()
        self.keys, self.problems, self.stack = set(), [], []

    def handle_starttag(self, tag, attrs):
        self.stack.append(tag)
        for k, v in attrs:
            if k in ("data-i18n", "data-i18n-aria"):
                self.keys.add(v)
            elif k in ("title", "aria-label", "placeholder", "alt") and v:
                self.problems.append(f"index.html: literal {k}={v!r} on <{tag}> (use data-i18n-aria)")

    def handle_endtag(self, tag):
        if tag in self.stack:
            while self.stack and self.stack.pop() != tag:
                pass

    def handle_data(self, data):
        if re.search(r"[^\W\d_]", data) and not (self.stack and self.stack[-1] in ("script", "style")):
            self.problems.append(f"index.html: bare text {data.strip()[:40]!r} (use data-i18n)")


def check(web=WEB):
    problems = []
    d = load_dict(web / "i18n.js")
    if set(d) != set(LANGS):
        problems.append(f"i18n.js: languages {sorted(d)} != {list(LANGS)}")
        return problems
    ref = set(d["en"])
    for lang in LANGS:
        ks = set(d[lang])
        for k in sorted(ref - ks):
            problems.append(f"i18n {lang}: missing key {k}")
        for k in sorted(ks - ref):
            problems.append(f"i18n {lang}: extra key {k}")
        for k in sorted(ks & ref):
            if not isinstance(d[lang][k], str) or not d[lang][k]:
                problems.append(f"i18n {lang}: empty value for {k}")
            elif placeholders(d[lang][k]) != placeholders(d["en"][k]):
                problems.append(f"i18n {lang}: placeholders of {k} differ from en")

    scripts = [p for p in sorted(web.rglob("*.js")) if p.name != "i18n.js"]
    used, prefixes = set(), set()
    for p in scripts:
        src = p.read_text(encoding="utf-8")
        prefixes |= set(PREFIX.findall(src))
        prefixes |= set(re.findall(r"G\.lbl\('([^']+)'", src))
        namespaces = {k.split(".", 1)[0] for k in ref if "." in k}
        for lit in LITERAL.findall(src):
            if lit in ref:
                used.add(lit)
            elif KEYLIKE.match(lit):
                if lit.split(".", 1)[0] in namespaces:
                    problems.append(f"{p.name}: key {lit!r} is not in the dictionary")
    for pre in sorted(prefixes):
        hits = {k for k in ref if k.startswith(pre)}
        if not hits:
            problems.append(f"dynamic key prefix {pre!r} matches no dictionary key")
        used |= hits

    h = _Html()
    h.feed((web / "index.html").read_text(encoding="utf-8"))
    problems += h.problems
    for k in sorted(h.keys - ref):
        problems.append(f"index.html: key {k!r} is not in the dictionary")
    used |= h.keys
    for k in sorted(ref - used):
        problems.append(f"i18n: key {k!r} is never used")

    for p in sorted(web.rglob("*")):
        if not p.is_file() or p.suffix not in (".js", ".css", ".html", ".json", ".svg"):
            continue
        src = p.read_text(encoding="utf-8")
        rel = p.relative_to(web).as_posix()
        if p.name != "i18n.js":
            for n, line in enumerate(src.splitlines(), 1):
                m = WIDE.search(line)
                if m:
                    problems.append(f"{rel}:{n}: hard-coded wide text {line[max(0, m.start() - 10):m.start() + 20].strip()!r}")
        problems += code_problems(rel, src)
    return problems


def main():
    problems = check()
    for p in problems:
        print(p)
    print("web check: " + ("OK" if not problems else f"{len(problems)} problem(s)"), file=sys.stderr)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
