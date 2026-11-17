"""Quota samples for glassbox.probe/1 `quota` (CONTRACT §1, §1.1 "额度").

Claude: the statusline tap (scripts/statusline-tap.sh) appends the statusline's
`rate_limits` to a JSONL file. Codex: token_count events in its transcripts carry
`rate_limits`. Idle sessions report stale (lower) values, but usage only grows within
one reset window, so each window is reported as a running maximum.
"""
import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path

UTC = timezone.utc
CLAUDE_WINDOWS = {"five_hour": "5h", "seven_day": "7d"}
CODEX_WINDOWS = {300: "5h", 10080: "7d"}


def _zulu(epoch):
    return datetime.fromtimestamp(epoch, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _epoch(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()


def account_code(raw, salt):
    """Salted hash of an account identifier; the identifier itself never leaves the machine."""
    if not raw:
        return "a_unknown"
    return "a_" + hashlib.sha256(f"{salt}\0{raw}".encode("utf-8")).hexdigest()[:8]


def _read_json(path):
    try:
        return json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def claude_account():
    oa = _read_json("~/.claude.json").get("oauthAccount") or {}
    return oa.get("accountUuid") or oa.get("organizationUuid")


def codex_account():
    return (_read_json("~/.codex/auth.json").get("tokens") or {}).get("account_id")


def _envelope(samples):
    """samples: (sampledAt epoch, window, usedPct, resetsAt epoch). Keep a running maximum per
    (window, resetsAt) and only the points where it rises, plus the last point of each window."""
    out, best, last = [], {}, {}
    for t, w, pct, reset in sorted(samples):
        k = (w, round(reset / 60))                     # reset times jitter by seconds
        if pct > best.get(k, -1):
            best[k] = pct
            out.append((t, w, pct, reset))
        last[k] = (t, w, best[k], reset)
    seen = {(t, w) for t, w, _, _ in out}
    out += [v for v in last.values() if (v[0], v[1]) not in seen]
    return sorted(out)


def claude_samples(paths, since):
    raw = []
    for p in paths:
        p = Path(p).expanduser()
        if not p.exists():
            continue
        with open(p, encoding="utf-8") as fh:
            for line in fh:
                try:
                    rec = json.loads(line)
                    ts = float(rec["ts"])
                    rl = rec["sample"]["r"]
                except (ValueError, KeyError, TypeError):
                    continue
                if ts < since or not isinstance(rl, dict):
                    continue
                for key, w in CLAUDE_WINDOWS.items():
                    v = rl.get(key)
                    if isinstance(v, dict) and isinstance(v.get("used_percentage"), (int, float)) \
                            and isinstance(v.get("resets_at"), (int, float)):
                        raw.append((ts, w, float(v["used_percentage"]), float(v["resets_at"])))
    return _envelope(raw)


def codex_samples(roots, since):
    raw = []
    for root in roots:
        root = Path(root).expanduser()
        if not root.is_dir():
            continue
        for f in root.rglob("*.jsonl"):
            try:
                if f.stat().st_mtime < since:
                    continue
            except OSError:
                continue
            with open(f, "rb") as fh:
                for line in fh:
                    if b'"rate_limits"' not in line:
                        continue
                    try:
                        rec = json.loads(line)
                        rl = rec["payload"]["rate_limits"]
                        ts = _epoch(rec["timestamp"])
                    except (ValueError, KeyError, TypeError):
                        continue
                    if ts < since or not isinstance(rl, dict):
                        continue
                    for slot in ("primary", "secondary"):
                        v = rl.get(slot)
                        if not isinstance(v, dict):
                            continue
                        w = CODEX_WINDOWS.get(v.get("window_minutes"))
                        if w and isinstance(v.get("used_percent"), (int, float)) and isinstance(v.get("resets_at"), (int, float)):
                            raw.append((ts, w, float(v["used_percent"]), float(v["resets_at"])))
    return _envelope(raw)


def collect(cfg, days=8, now=None):
    since = (now or time.time()) - days * 86400
    salt = cfg.get("account_salt", "glassbox")
    out = []
    for agent, account, samples in (
            ("claude-code", claude_account(), claude_samples(cfg.get("claude_quota_samples", []), since)),
            ("codex", codex_account(), codex_samples(cfg["codex_roots"], since))):
        code = account_code(account, salt)
        out += [{"account": code, "agent": agent, "window": w, "usedPct": pct,
                 "resetsAt": _zulu(reset), "sampledAt": _zulu(t)} for t, w, pct, reset in samples]
    return out
