"""Parse Claude Code and Codex transcripts into de-duplicated request rows (PLAN §4).

Files are read incrementally: each file remembers how many bytes were consumed, and
only complete lines are parsed. A file that shrank or was replaced is re-read from 0;
its requests are idempotent upserts keyed by message / response id, so re-reading is safe.
"""
import json
import os
from pathlib import Path

from . import pricing, state

MAX_LINE = 64 * 1024 * 1024


def _int(v):
    return v if isinstance(v, int) and not isinstance(v, bool) and v > 0 else 0


def _born(st):
    return getattr(st, "st_birthtime", None) or st.st_ctime


def _row(rid, agent, ts, model, session, cwd, born, inp, out, cr, cw5, cw1, reasoning):
    t = {"input": inp, "output": out, "cache_read": cr, "cache_write5m": cw5, "cache_write1h": cw1}
    return {"id": rid, "agent": agent, "ts": ts, "model": model, "session": session, "cwd": cwd,
            "born": born, **t, "reasoning": reasoning, "cost": pricing.cost(model, t)}


def _cache_split(u):
    """Claude cache writes split by TTL; fall back to 5m when the split is missing."""
    total = _int(u.get("cache_creation_input_tokens"))
    cc = u.get("cache_creation") if isinstance(u.get("cache_creation"), dict) else {}
    w5, w1 = _int(cc.get("ephemeral_5m_input_tokens")), _int(cc.get("ephemeral_1h_input_tokens"))
    if w5 + w1 != total:
        w1 = min(w1, total)
        w5 = total - w1
    return w5, w1


def _base_model(m):
    if not isinstance(m, str) or not m:
        return "other"
    m = m.split("/")[-1]                       # provider prefixes / ARN tails
    if m.startswith("arn:"):
        return "other"
    for suffix in ("[1m]",):
        m = m.replace(suffix, "")
    parts = m.split("-")
    if len(parts) > 1 and parts[-1].isdigit() and len(parts[-1]) == 8:   # date suffix
        m = "-".join(parts[:-1])
    return m


# ---------------------------------------------------------------------------- Claude
def claude_rows(rec, born):
    """Yield request rows for one Claude transcript record (only assistant messages with usage)."""
    if rec.get("type") != "assistant":
        return
    msg = rec.get("message")
    if not isinstance(msg, dict):
        return
    u = msg.get("usage")
    mid = msg.get("id") or rec.get("requestId")
    if not isinstance(u, dict) or not isinstance(mid, str):
        return
    model = _base_model(msg.get("model"))
    if model == "<synthetic>":
        return
    if u.get("speed") == "fast":
        model += ":fast"
    ts, session, cwd = rec.get("timestamp"), rec.get("sessionId"), rec.get("cwd")
    if not isinstance(ts, str):
        return
    details = u.get("output_tokens_details") if isinstance(u.get("output_tokens_details"), dict) else {}
    w5, w1 = _cache_split(u)
    # Top-level usage is the sum of the "message" iterations only (PLAN §4).
    yield _row("c:" + mid, "claude-code", ts, model, session, cwd, born,
               _int(u.get("input_tokens")), _int(u.get("output_tokens")),
               _int(u.get("cache_read_input_tokens")), w5, w1, _int(details.get("thinking_tokens")))
    its = u.get("iterations")
    if isinstance(its, list):
        for i, it in enumerate(its):
            if not isinstance(it, dict) or it.get("type") in (None, "message"):
                continue
            aw5, aw1 = _cache_split(it)
            yield _row(f"c:{mid}#{it.get('type')}{i}", "claude-code", ts, _base_model(it.get("model")),
                       session, cwd, born, _int(it.get("input_tokens")), _int(it.get("output_tokens")),
                       _int(it.get("cache_read_input_tokens")), aw5, aw1, 0)


# ---------------------------------------------------------------------------- Codex
def _codex_usage(u):
    inp, cached = _int(u.get("input_tokens")), _int(u.get("cached_input_tokens"))
    return (max(0, inp - cached), _int(u.get("output_tokens")), cached,
            _int(u.get("cache_write_input_tokens")), 0, _int(u.get("reasoning_output_tokens")))


def codex_rows(rec, st, born):
    """st carries per-file state across incremental reads: model, session, cwd, has_records."""
    typ, p = rec.get("type"), rec.get("payload")
    if not isinstance(p, dict):
        return
    if typ == "session_meta":
        if "cwd" not in st:                    # first session_meta is the file's own thread
            st["cwd"] = p.get("cwd")
            st["session"] = p.get("session_id") or p.get("id")
        return
    if typ == "turn_context":
        if isinstance(p.get("model"), str):
            st["model"] = p["model"]
        return
    ts = rec.get("timestamp")
    if not isinstance(ts, str):
        return
    model = _base_model(st.get("model"))
    if typ == "token_usage_record" and isinstance(p.get("usage"), dict) and p.get("response_id"):
        st["has_records"] = True
        yield _row("x:" + p["response_id"], "codex", ts, model, st.get("session"), st.get("cwd"), born,
                   *_codex_usage(p["usage"]))
    elif typ == "event_msg" and p.get("type") == "token_count" and not st.get("has_records"):
        info = p.get("info") if isinstance(p.get("info"), dict) else {}
        last = info.get("last_token_usage")
        if isinstance(last, dict):             # older Codex: one event per request
            yield _row(f"x:{st.get('session')}:{ts}", "codex", ts, model, st.get("session"),
                       st.get("cwd"), born, *_codex_usage(last))


# ---------------------------------------------------------------------------- scanning
def _files(roots):
    for root in roots:
        root = Path(root).expanduser()
        if root.is_dir():
            yield from root.rglob("*.jsonl")


def scan(conn, claude_roots, codex_roots, progress=None):
    """Bring the requests table up to date. Returns counters."""
    stats = {"files": 0, "read": 0, "bytes": 0, "rows": 0}
    known = {r[0]: r[1:] for r in conn.execute("SELECT path, mtime, size, offset, state FROM files")}
    for agent, roots in (("claude-code", claude_roots), ("codex", codex_roots)):
        for path in _files(roots):
            stats["files"] += 1
            try:
                st_ = path.stat()
            except OSError:
                continue
            key = str(path)
            mtime, size, offset, fstate = known.get(key, (None, None, 0, None))
            if mtime == st_.st_mtime and size == st_.st_size:
                continue
            if size is None or st_.st_size < size:
                offset, fstate = 0, None           # new, truncated or replaced: read from the start
            fst = json.loads(fstate) if fstate else {}
            born = _born(st_)
            n_rows, consumed = 0, offset
            batch = []
            with open(path, "rb") as fh:
                fh.seek(offset)
                for line in fh:
                    if not line.endswith(b"\n"):
                        break                       # still being written
                    consumed += len(line)
                    if len(line) > MAX_LINE:
                        continue
                    if agent == "claude-code":
                        if b'"usage"' not in line:
                            continue
                    elif not (b"token_usage_record" in line or b"token_count" in line
                              or b"session_meta" in line or b"turn_context" in line):
                        continue
                    try:
                        rec = json.loads(line)
                    except ValueError:
                        continue
                    if not isinstance(rec, dict):
                        continue
                    rows = claude_rows(rec, born) if agent == "claude-code" else codex_rows(rec, fst, born)
                    batch.extend(rows)
            if batch:
                conn.executemany(state.UPSERT, batch)
                n_rows = len(batch)
            conn.execute(
                "INSERT INTO files(path, agent, mtime, size, offset, born, state) VALUES(?,?,?,?,?,?,?) "
                "ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime, size=excluded.size, "
                "offset=excluded.offset, born=excluded.born, state=excluded.state",
                (key, agent, st_.st_mtime, st_.st_size, consumed, born, json.dumps(fst) if fst else None))
            stats["read"] += 1
            stats["bytes"] += consumed - offset
            stats["rows"] += n_rows
            if stats["read"] % 200 == 0:
                conn.commit()
                if progress:
                    progress(stats)
    conn.commit()
    return stats


def reprice(conn):
    """Recompute every request's cost after the price table changed."""
    rows = conn.execute("SELECT id, model, input, output, cache_read, cache_write5m, cache_write1h FROM requests").fetchall()
    conn.executemany("UPDATE requests SET cost=? WHERE id=?", [
        (pricing.cost(m, {"input": i, "output": o, "cache_read": cr, "cache_write5m": w5, "cache_write1h": w1}), rid)
        for rid, m, i, o, cr, w5, w1 in rows])
    conn.commit()


def sync_warnings(roots):
    """CONTRACT §1.1: transcripts synced from other machines would be double counted."""
    marks = ("Dropbox", "Mobile Documents", "OneDrive", "Google Drive", "GoogleDrive", "Syncthing")
    out = []
    for r in roots:
        p = Path(r).expanduser()
        real = os.path.realpath(p)
        if p.is_symlink() or any(m in real for m in marks):
            out.append(f"{r} looks synced from elsewhere ({'symlink' if p.is_symlink() else 'sync folder'})")
    return out
