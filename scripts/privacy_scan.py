#!/usr/bin/env python3
"""Scan files that would be published for private information.

The private term list lives outside git, in .local/redact_terms.local.json:
    {"terms": [...], "allow": [...]}
Terms match case-insensitively on word boundaries. Built-in patterns catch
private IPv4 addresses, e-mail addresses, absolute home paths and macOS volume
paths. Strings listed in "allow" never count as hits.

Usage:
    python3 scripts/privacy_scan.py              # files git would track
    python3 scripts/privacy_scan.py PATH...      # specific files or directories

Exit status: 0 when clean, 1 when anything matched, 2 on setup errors.
Hits are printed with the matched text partly masked, so the report itself
can be pasted into an issue without leaking the full value.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TERMS_FILE = ROOT / ".local" / "redact_terms.local.json"

PATTERNS = {
    "private-ipv4": re.compile(
        r"(?<![\d.])(?:10\.(?:\d{1,3}\.){2}\d{1,3}"
        r"|192\.168\.\d{1,3}\.\d{1,3}"
        r"|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?![\d.])"),
    "email": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    "home-path": re.compile(r"(?:/Users/|/home/|[A-Za-z]:\\Users\\)[A-Za-z0-9._-]+"),
    "volume-path": re.compile(r"/Volumes/[A-Za-z0-9._-]+"),
}
# Placeholders that look like matches but are deliberately generic.
SAFE = {
    "email": re.compile(r"@(?:example\.(?:com|org)|users\.noreply\.github\.com|anthropic\.com)$", re.I),
}
TEXT_LIMIT = 5 * 1024 * 1024


def load_terms():
    if not TERMS_FILE.exists():
        print(f"setup error: {TERMS_FILE.relative_to(ROOT)} not found", file=sys.stderr)
        sys.exit(2)
    data = json.loads(TERMS_FILE.read_text(encoding="utf-8"))
    allow = {a.casefold() for a in data.get("allow", [])}
    terms = [t for t in data.get("terms", []) if t and t.casefold() not in allow]
    term_re = re.compile(
        r"(?<![A-Za-z0-9_])(?:" + "|".join(re.escape(t) for t in sorted(terms, key=len, reverse=True)) + r")(?![A-Za-z0-9_])",
        re.I) if terms else None
    return term_re, allow


def candidate_files(args):
    if args:
        out = []
        for a in args:
            p = Path(a)
            out.extend(sorted(x for x in p.rglob("*") if x.is_file()) if p.is_dir() else [p])
        return out
    res = subprocess.run(["git", "ls-files", "-co", "--exclude-standard", "-z"],
                         cwd=ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        print("setup error: not a git repository (run git init, or pass paths)", file=sys.stderr)
        sys.exit(2)
    return [ROOT / f for f in res.stdout.split("\0") if f]


def mask(s):
    return s if len(s) <= 3 else s[:2] + "*" * (len(s) - 3) + s[-1]


def scan(path, term_re, allow):
    try:
        if path.stat().st_size > TEXT_LIMIT:
            return [], "skipped (too large)"
        raw = path.read_bytes()
    except OSError as e:
        return [], f"unreadable: {e}"
    if b"\0" in raw[:8192]:
        return [], "binary"
    text = raw.decode("utf-8", errors="replace")
    hits = []
    for n, line in enumerate(text.splitlines(), 1):
        if term_re:
            for m in term_re.finditer(line):
                hits.append((n, "term", m.group(0)))
        for kind, rx in PATTERNS.items():
            for m in rx.finditer(line):
                s = m.group(0)
                if s.casefold() in allow or (kind in SAFE and SAFE[kind].search(s)):
                    continue
                hits.append((n, kind, s))
    return hits, None


def main():
    term_re, allow = load_terms()
    files = candidate_files(sys.argv[1:])
    total, binaries = 0, []
    for f in files:
        hits, note = scan(f, term_re, allow)
        rel = os.path.relpath(f, ROOT)
        if note:
            binaries.append(f"{rel} ({note})")
        for n, kind, s in hits:
            total += 1
            print(f"{rel}:{n}: [{kind}] {mask(s)}")
    print(f"\nscanned {len(files)} files, {total} hit(s); {len(binaries)} not text-scanned")
    for b in binaries:
        print(f"  not scanned: {b}")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
