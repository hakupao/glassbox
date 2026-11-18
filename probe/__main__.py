"""glassbox probe command line.

    python -m probe [--config FILE] scan               # update the local request cache
    python -m probe [--config FILE] report [--days N]  # print a glassbox.probe/1 report (usage part)
    python -m probe [--config FILE] daily [--days N]   # local-time daily totals, for checking by hand
    python -m probe [--config FILE] push [--days N]    # scan + report + POST to the hub

Config (TOML, optional; defaults shown):
    machine = "A"                       # this machine's code
    tz = "Asia/Tokyo"                   # only used by `daily`; the hub cuts days itself
    state = "~/.glassbox/probe.sqlite"
    claude_roots = ["~/.claude/projects"]
    codex_roots = ["~/.codex/sessions"]
    claude_quota_samples = []           # statusline tap output files (scripts/statusline-tap.sh)
    account_salt = "glassbox"           # use the same random value on every machine
    git_roots = []                      # directories holding repositories (one level deep)
    author_emails = []                  # only commits by these authors are reported
    git_days = 60
    jobs = []                           # [{name, path, ok = "success regex"}]
    hub_url = "https://glassbox.<tailnet>.ts.net"
    hub_token_file = "~/.glassbox/hub.token"
    [ssh_aliases]                       # ssh host alias -> real host, for remote normalization
"""
import argparse
import json
import os
import sys
import time
import tomllib
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from . import local, logs, pricing, quota, report, state

DEFAULTS = {"machine": "A", "tz": "Asia/Tokyo", "state": "~/.glassbox/probe.sqlite",
            "claude_roots": ["~/.claude/projects"], "codex_roots": ["~/.codex/sessions"], "ssh_aliases": {},
            "claude_quota_samples": [], "account_salt": "glassbox"}


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


def build_report(conn, cfg, days, rebaseline=False):
    body = report.usage(conn, cfg["machine"], days=days, aliases=cfg["ssh_aliases"])
    if rebaseline:
        body["usage"]["rebaseline"] = True
    body["quota"] = quota.collect(cfg)
    body["git"], used = local.git_activity(conn, cfg)
    body["projects"].update(used)
    body["runtimes"] = local.runtimes(cfg)
    body["jobs"] = local.jobs(cfg)
    return report.envelope(cfg["machine"], cfg["tz"], body)


def cmd_report(conn, cfg, args):
    print(json.dumps(build_report(conn, cfg, args.days), ensure_ascii=False, indent=1))


def cmd_push(conn, cfg, args):
    """Scan, build the report and POST it to the hub (CONTRACT §1)."""
    import gzip
    import http.client
    import urllib.error
    import urllib.request
    cmd_scan(conn, cfg, args)
    rep = build_report(conn, cfg, args.days, rebaseline=args.rebaseline)
    token = Path(cfg["hub_token_file"]).expanduser().read_text(encoding="utf-8").strip()
    req = urllib.request.Request(cfg["hub_url"].rstrip("/") + "/ingest", method="POST",
                                 data=gzip.compress(json.dumps(rep).encode("utf-8")),
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                                          "Content-Encoding": "gzip"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            print("pushed:", r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"hub refused ({e.code}): {e.read().decode('utf-8', 'replace')}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"hub unreachable: {e.reason}", file=sys.stderr)
        sys.exit(1)
    except (OSError, http.client.HTTPException) as e:
        print(f"hub connection failed: {type(e).__name__}", file=sys.stderr)
        sys.exit(1)


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


def windowless_log(home=None):
    """pythonw.exe (Windows, no console window) sets sys.stdout / sys.stderr to None, so every message
    and traceback would be lost. Then append them to ~/.glassbox/probe.log instead (rotated at 1 MB).
    With a console nothing changes."""
    if sys.stdout is not None and sys.stderr is not None:
        return None
    path = Path(home or Path.home()) / ".glassbox" / "probe.log"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() and path.stat().st_size > 1_000_000:
            try:
                path.replace(path.with_name("probe.log.1"))
            except OSError:                   # another run or a scanner holds it (Windows): keep appending
                pass
        f = open(path, "a", encoding="utf-8", buffering=1)
    except OSError:                           # never die silently on the log itself
        f, path = open(os.devnull, "w", encoding="utf-8"), None
    if sys.stdout is None:
        sys.stdout = f
    if sys.stderr is None:
        sys.stderr = f
    print(f"--- {datetime.now().astimezone().isoformat(timespec='seconds')} (no console)", file=f)
    return path


def main(argv=None):
    windowless_log()
    ap = argparse.ArgumentParser(prog="probe")
    ap.add_argument("--config")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("scan")
    for name in ("report", "daily", "push"):
        p = sub.add_parser(name)
        p.add_argument("--days", type=int, default=3)
        if name == "push":
            p.add_argument("--rebaseline", action="store_true",
                           help="ask the hub to accept shrinking history (needs a newer probe or `hub machine rebaseline`)")
    args = ap.parse_args(argv)
    cfg = load_config(args.config)
    conn = state.connect(cfg["state"])
    {"scan": cmd_scan, "report": cmd_report, "daily": cmd_daily, "push": cmd_push}[args.cmd](conn, cfg, args)


if __name__ == "__main__":
    main()
