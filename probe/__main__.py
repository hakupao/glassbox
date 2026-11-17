"""glassbox probe command line.

    python -m probe [--config FILE] scan               # update the local request cache
    python -m probe [--config FILE] report [--days N]  # print a glassbox.probe/1 report (usage part)
    python -m probe [--config FILE] daily [--days N]   # local-time daily totals, for checking by hand

Config (TOML, optional; defaults shown):
    machine = "A"                       # this machine's code
    tz = "Asia/Tokyo"                   # only used by `daily`; the hub cuts days itself
    state = "~/.glassbox/probe.sqlite"
    claude_roots = ["~/.claude/projects"]
    codex_roots = ["~/.codex/sessions"]
    [ssh_aliases]                       # ssh host alias -> real host, for remote normalization
"""
import argparse
import json
import sys
import time
import tomllib
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from . import logs, pricing, report, state

DEFAULTS = {"machine": "A", "tz": "Asia/Tokyo", "state": "~/.glassbox/probe.sqlite",
            "claude_roots": ["~/.claude/projects"], "codex_roots": ["~/.codex/sessions"], "ssh_aliases": {}}


def load_config(path):
    cfg = dict(DEFAULTS)
    if path:
        cfg.update(tomllib.loads(Path(path).expanduser().read_text(encoding="utf-8")))
    return cfg


def cmd_scan(conn, cfg, args):
    for w in logs.sync_warnings(cfg["claude_roots"] + cfg["codex_roots"]):
        print("warning:", w, file=sys.stderr)
    if state.get_meta(conn, "pricing") != pricing.VERSION:
        logs.reprice(conn)
        state.set_meta(conn, "pricing", pricing.VERSION)
        conn.commit()
    t0 = time.time()
    s = logs.scan(conn, cfg["claude_roots"], cfg["codex_roots"],
                  progress=lambda s: print(f"  … {s['read']} files read, {s['bytes'] / 1e9:.2f} GB, {s['rows']} rows",
                                           file=sys.stderr))
    n = conn.execute("SELECT COUNT(*) FROM requests").fetchone()[0]
    print(f"scanned {s['files']} files, read {s['read']} ({s['bytes'] / 1e9:.2f} GB), "
          f"{s['rows']} rows upserted, {n} unique requests, {time.time() - t0:.1f}s")


def cmd_report(conn, cfg, args):
    body = report.usage(conn, cfg["machine"], days=args.days, aliases=cfg["ssh_aliases"])
    print(json.dumps(report.envelope(cfg["machine"], cfg["tz"], body), ensure_ascii=False, indent=1))


def cmd_daily(conn, cfg, args):
    tz = ZoneInfo(cfg["tz"])
    since = (datetime.now(tz) - timedelta(days=args.days)).date()
    agg = defaultdict(lambda: [0, 0, 0, 0, 0, 0.0, 0])
    for ts, agent, i, o, cr, w5, w1, cost in conn.execute(
            "SELECT ts, agent, input, output, cache_read, cache_write5m, cache_write1h, cost FROM requests"):
        d = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(tz).date()
        if d < since:
            continue
        a = agg[(d.isoformat(), agent)]
        a[0] += 1; a[1] += i; a[2] += o; a[3] += cr; a[4] += w5 + w1
        if cost is None:
            a[6] += 1
        else:
            a[5] += cost
    print(f"{'date':10} {'agent':11} {'req':>6} {'input':>11} {'output':>11} {'cacheRead':>13} {'cacheWrite':>12} {'usd':>9} unpriced")
    for (d, agent), a in sorted(agg.items()):
        print(f"{d:10} {agent:11} {a[0]:6} {a[1]:11} {a[2]:11} {a[3]:13} {a[4]:12} {a[5]:9.2f} {a[6]}")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="probe")
    ap.add_argument("--config")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("scan")
    for name in ("report", "daily"):
        p = sub.add_parser(name)
        p.add_argument("--days", type=int, default=3)
    args = ap.parse_args(argv)
    cfg = load_config(args.config)
    conn = state.connect(cfg["state"])
    {"scan": cmd_scan, "report": cmd_report, "daily": cmd_daily}[args.cmd](conn, cfg, args)


if __name__ == "__main__":
    main()
