"""glassbox hub command line.

    python -m hub [--config FILE] serve
    python -m hub [--config FILE] machine add ID --role dev|work|deploy|gitea --os macos|windows|linux
                                                  # prints a new token once; only its hash is stored
    python -m hub [--config FILE] machine rebaseline ID   # accept shrinking history from ID for 1 hour
    python -m hub [--config FILE] collect [github|gitea|all]

Config (TOML, optional; defaults shown):
    db = "~/.glassbox/hub.sqlite"
    host = "127.0.0.1"
    port = 8787
    tz = "Asia/Tokyo"
    [github]  login = "...", token_env = "GITHUB_TOKEN"
    [[gitea]] name = "...", url = "https://...", user = "...", token_env = "..."
    [beszel]  url = "...", user = "...", password_env = "BESZEL_PASSWORD"; [beszel.map] "<system name>" = "C"
    [kuma]    url = "...", slug = "...", machine = "C"
    [docker]  url = "http://docker-proxy:2375", machine = "C"
    [tailscale] socket = "/var/run/tailscale/tailscaled.sock"   # or cli = "tailscale"
"""
import argparse
import secrets
import sys
import time
import tomllib
from pathlib import Path

from . import db, server

DEFAULTS = {"db": "~/.glassbox/hub.sqlite", "host": "127.0.0.1", "port": 8787, "tz": "Asia/Tokyo"}


def load_config(path):
    cfg = dict(DEFAULTS)
    if path:
        cfg.update(tomllib.loads(Path(path).expanduser().read_text(encoding="utf-8")))
    return cfg


def main(argv=None):
    ap = argparse.ArgumentParser(prog="hub")
    ap.add_argument("--config")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("serve")
    m = sub.add_parser("machine")
    msub = m.add_subparsers(dest="action", required=True)
    add = msub.add_parser("add")
    add.add_argument("id")
    add.add_argument("--role", required=True, choices=["dev", "work", "deploy", "gitea"])
    add.add_argument("--os", required=True, choices=["macos", "windows", "linux"])
    rb = msub.add_parser("rebaseline")
    rb.add_argument("id")
    c = sub.add_parser("collect")
    c.add_argument("what", nargs="?", default="all", choices=["github", "gitea", "monitors", "all"])
    args = ap.parse_args(argv)
    cfg = load_config(args.config)
    conn = db.connect(cfg["db"])

    if args.cmd == "serve":
        server.serve(conn, cfg["host"], int(cfg["port"]))
    elif args.cmd == "machine" and args.action == "add":
        token = secrets.token_urlsafe(32)
        conn.execute("INSERT INTO machines(id, token_sha, role, os) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                     "token_sha=excluded.token_sha, role=excluded.role, os=excluded.os",
                     (args.id, server.token_sha(token), args.role, args.os))
        conn.commit()
        print(token)
        print(f"machine {args.id}: token shown once; store it in that machine's probe config", file=sys.stderr)
    elif args.cmd == "machine" and args.action == "rebaseline":
        cur = conn.execute("UPDATE machines SET rebaseline_until=? WHERE id=?", (time.time() + 3600, args.id))
        conn.commit()
        if not cur.rowcount:
            sys.exit(f"no machine {args.id}")
        print(f"machine {args.id}: next report may rebaseline (valid 1 hour)")
    elif args.cmd == "collect":
        from . import monitors, sources
        if args.what in ("github", "gitea", "all"):
            sources.collect(conn, cfg, args.what)
        if args.what in ("monitors", "all"):
            print("monitors:", monitors.collect(conn, cfg))


if __name__ == "__main__":
    main()
