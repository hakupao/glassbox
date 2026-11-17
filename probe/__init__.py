"""glassbox probe: turns this machine's Claude Code / Codex logs (and later quota, git
and runtime facts) into the aggregate report defined by schema/CONTRACT.md §1.

Standard library only (Python 3.12). Nothing it reports contains conversation text,
commands, absolute paths, session IDs or file names.
"""
VERSION = "0.1.0"
