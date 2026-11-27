"""Quota samples for glassbox.probe/1 `quota` (CONTRACT §1, §1.1 "额度").

Claude: the statusline tap (scripts/statusline-tap.sh) appends the statusline's
`rate_limits` to a JSONL file. Codex: token_count events in its transcripts carry
`rate_limits`. Idle sessions report stale (lower) values, and usage only grows within
one reset window, so each window is reported as a running maximum.

The exception is a reset inside a window (the user resets the limit by hand: usage falls,
the reset time stays). A session that reports a value different from its own last one has
news; when one session has such news well below the maximum twice, a minute or more apart,
the window was reset and the maximum starts again there (see _envelope).
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


DROP = 5            # points that count as far from the maximum: less is two sessions reporting a moment apart
HOLD = 60           # seconds a far value must last: a session that wakes shows an old number for a second or two


def _envelope(samples):
    """samples: (sampledAt epoch, window, usedPct, resetsAt epoch[, session]). Per (window, resetsAt): a running
    maximum, the points where it rises, and its last point.

    A reset inside the window is read from "news" only: a session reporting a value different from its own last
    one. News DROP or more below the maximum puts that session in doubt; when the same session has news that low
    again HOLD seconds or more later, and nobody had news that was not low in between, the window was reset: the
    old run is closed on its last point and the maximum starts again from that value. (One low value is not
    enough: a waking session first shows a number from earlier, then corrects it.)
    Every other sample (a session's first, a repeat, one without a session id) can only raise the maximum, and
    after a reset is not read at all, as it may be a number from before the reset. After a reset, news far above
    the maximum is taken at once from a session already heard in the new run, and from any other session only
    once it has lasted HOLD seconds in the same way."""
    out, st = [], {}
    for t, w, pct, reset, *rest in sorted(samples, key=lambda x: x[:4]):
        sid = rest[0] if rest else None
        k = (w, round(reset / 60))                     # reset times jitter by seconds
        z = st.setdefault(k, {"best": -1, "last": None, "prev": {}, "reset": False, "doubt": {}, "run": set()})
        prev = z["prev"].get(sid) if sid else None
        if sid:
            z["prev"][sid] = pct
        take = False
        if prev is None or pct == prev:                # not news: raise only, and only while no reset was seen
            take = not z["reset"] and pct > z["best"]
        else:
            side = (0 if z["best"] < 0 else -1 if pct <= z["best"] - DROP
                    else 1 if z["reset"] and sid not in z["run"] and pct >= z["best"] + DROP else 0)
            if not side:
                z["doubt"], take = {}, pct > z["best"]
                z["run"].add(sid)
            elif z["doubt"].get(sid, (0, 0))[0] != side:
                z["doubt"][sid] = (side, t)
            elif t - z["doubt"][sid][1] >= HOLD:       # it lasted: the window was reset (or, after one, really is that high)
                if side < 0:
                    out.append(z["last"])              # the last point before the fall
                    z.update(reset=True, run=set())
                z["doubt"], z["best"], take = {}, -1, True
                z["run"].add(sid)
        if take:
            z["best"] = pct
            out.append((t, w, pct, reset))
        if z["best"] >= 0:
            z["last"] = (t, w, z["best"], reset)
    out += [z["last"] for z in st.values() if z["last"]]
    # one point per reported second and window (the hub keeps the first it gets): the later one wins
    return sorted({(int(t), w): (t, w, pct, reset) for t, w, pct, reset in sorted(set(out))}.values())


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
                    sid = rec["sample"].get("s") if isinstance(rec["sample"].get("s"), str) else None
                except (ValueError, KeyError, TypeError):
                    continue
                if ts < since or not isinstance(rl, dict):
                    continue
                for key, w in CLAUDE_WINDOWS.items():
                    v = rl.get(key)
                    if isinstance(v, dict) and isinstance(v.get("used_percentage"), (int, float)) \
                            and isinstance(v.get("resets_at"), (int, float)):
                        raw.append((ts, w, float(v["used_percentage"]), float(v["resets_at"]), sid))
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
                            raw.append((ts, w, float(v["used_percent"]), float(v["resets_at"]), str(f)))      # one transcript = one session
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
