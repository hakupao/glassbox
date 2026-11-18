"""Publish the public snapshot to the gh-pages branch (S15).

One run: fetch the private page from the hub -> export (hub.export) -> write index.html and CNAME
to a fresh directory -> run the publish gate (scripts/verify_public.py) on exactly that directory
-> if gh-pages already holds the same two files, stop -> otherwise create ONE parentless commit
through the GitHub Git Data API and force-move gh-pages to it (no history of older snapshots).
Any failure publishes nothing. Messages never carry private values or the token.

Off by default: without a token file it logs "publish disabled" and does nothing, so deploying
the publisher container does not publish. The first publish is a deliberate step.

Settings: GLASSBOX_PUBLISH_DIR (default /run/glassbox-publish; never the hub's secrets) holds
token, public.toml, terms.json, settings.toml [, kuma_push]. settings.toml has repo, cname, branch,
source, interval; GLASSBOX_PUBLISH_<KEY> environment variables override it (tests):
    GLASSBOX_PUBLISH_REPO     owner/name
    GLASSBOX_PUBLISH_BRANCH   default gh-pages
    GLASSBOX_PUBLISH_CNAME    custom domain written to CNAME (required)
    GLASSBOX_PUBLISH_SOURCE   private page URL, default http://127.0.0.1:8787/page.json
    GLASSBOX_PUBLISH_INTERVAL seconds between runs with --loop, default 3600 (GitHub Pages: soft
                              limit 10 builds per hour)

    python -m hub.publish [--once | --loop]
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from . import export as ex
from .bundle import bundle

ROOT = Path(__file__).resolve().parent.parent
API = "https://api.github.com"
UA = "glassbox-publisher"
PAGES_BRANCH = "gh-pages"          # the only branch this code ever writes (review: allowlist, not blocklist)


class PublishError(Exception):
    """Messages are safe to log: no values from the page, the config or the token."""


def _gate_module():
    spec = importlib.util.spec_from_file_location("verify_public", ROOT / "scripts" / "verify_public.py")
    if spec is None or spec.loader is None:
        raise PublishError("publish gate not found (scripts/verify_public.py)")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


class GitHub:
    def __init__(self, repo, token, api=API):
        self.repo, self.token, self.api = repo, token, api.rstrip("/")

    def call(self, method, path, body=None, ok=(200, 201)):
        req = urllib.request.Request(f"{self.api}/repos/{self.repo}{path}", method=method,
                                     data=None if body is None else json.dumps(body).encode(),
                                     headers={"Authorization": f"Bearer {self.token}", "User-Agent": UA,
                                              "Accept": "application/vnd.github+json",
                                              "X-GitHub-Api-Version": "2022-11-28",
                                              **({"Content-Type": "application/json"} if body is not None else {})})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                status, data = r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            status, data = e.code, None
        if status not in ok:
            raise PublishError(f"GitHub {method} {path.split('?')[0]} answered HTTP {status}")
        return status, data

    def current_files(self, branch):
        """{path: blob sha} of the branch tip, or None when the branch does not exist."""
        status, ref = self.call("GET", f"/git/ref/heads/{urllib.parse.quote(branch, safe='')}", ok=(200, 404, 409))
        if status == 409:
            raise PublishError("the repository is empty: push at least one commit first")
        if status == 404:
            return None
        _, commit = self.call("GET", f"/git/commits/{ref['object']['sha']}")
        _, tree = self.call("GET", f"/git/trees/{commit['tree']['sha']}")
        return {e["path"]: e["sha"] for e in tree.get("tree", []) if e.get("type") == "blob"}

    def replace_branch(self, branch, files, message, exists):
        entries = []
        for name, data in sorted(files.items()):
            _, blob = self.call("POST", "/git/blobs", {"content": base64.b64encode(data).decode(), "encoding": "base64"})
            entries.append({"path": name, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        _, tree = self.call("POST", "/git/trees", {"tree": entries})
        _, commit = self.call("POST", "/git/commits", {"message": message, "tree": tree["sha"], "parents": []})
        if exists:
            self.call("PATCH", f"/git/refs/heads/{urllib.parse.quote(branch, safe='')}", {"sha": commit["sha"], "force": True})
        else:
            self.call("POST", "/git/refs", {"ref": f"refs/heads/{branch}", "sha": commit["sha"]})
        return commit["sha"]


def _read(path, what):
    try:
        return Path(path).read_text(encoding="utf-8")
    except OSError as e:
        raise PublishError(f"cannot read {what} ({e.__class__.__name__})") from None


def build(private, publish_dir, cname):
    """Export + gate. Returns {name: bytes} for exactly the files that passed the gate. The terms and
    config are read once; export and gate both work from those same bytes."""
    d = Path(publish_dir)
    terms_raw = _read(d / "terms.json", "terms.json")
    config_raw = _read(d / "public.toml", "public.toml")
    vp = _gate_module()
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        (t / "terms.json").write_text(terms_raw, encoding="utf-8")
        (t / "public.toml").write_text(config_raw, encoding="utf-8")
        try:
            terms = ex.load_terms(t / "terms.json")
            pub, _ = ex.export(private, ex.load_config(t / "public.toml", terms), terms)
        except ex.ExportError as e:                   # its messages carry no private values
            raise PublishError(f"export failed: {e}") from None
        files = {"index.html": bundle(pub).encode("utf-8"), "CNAME": (cname + "\n").encode("ascii")}
        site = t / "site"
        site.mkdir()
        for name, data in files.items():
            (site / name).write_bytes(data)
        try:
            gate = vp.Gate(json.loads(terms_raw), private, tomllib.loads(config_raw))
            problems = gate.check_file(site)
        except Exception as e:                        # noqa: BLE001  setup errors: fail closed
            raise PublishError(f"gate setup failed ({e.__class__.__name__})") from None
    if problems:
        # The gate's own messages hide private values (ordinals only), so they are safe to log.
        for p in problems[:20]:
            print(f"publish gate: {p}", file=sys.stderr, flush=True)
        raise PublishError(f"gate rejected the snapshot: {len(problems)} problem(s)")
    return files


def fetch_private(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
            page = json.loads(r.read())
    except (OSError, ValueError) as e:
        raise PublishError(f"cannot fetch the private page ({e.__class__.__name__})") from None
    if not isinstance(page, dict) or page.get("schema") != "glassbox.page/1" or page.get("view") == "public":
        raise PublishError("the source is not a private glassbox.page/1")
    return page


def settings(env):
    """settings.toml in the publish directory, overridden by GLASSBOX_PUBLISH_<KEY> variables."""
    d = Path(env.get("GLASSBOX_PUBLISH_DIR", "/run/glassbox-publish"))
    try:
        s = tomllib.loads((d / "settings.toml").read_text(encoding="utf-8")) if (d / "settings.toml").is_file() else {}
    except (OSError, ValueError) as e:
        raise PublishError(f"cannot read settings.toml ({e.__class__.__name__})") from None
    s = {k: str(v) for k, v in s.items()}
    for k in ("repo", "cname", "branch", "source", "interval"):
        if env.get(f"GLASSBOX_PUBLISH_{k.upper()}"):
            s[k] = env[f"GLASSBOX_PUBLISH_{k.upper()}"]
    return d, s


def run_once(env=os.environ, api=API):
    d = Path(env.get("GLASSBOX_PUBLISH_DIR", "/run/glassbox-publish"))
    token = (d / "token").read_text(encoding="utf-8").strip() if (d / "token").is_file() else ""
    if not token:
        return "disabled"
    d, cfg = settings(env)
    repo, cname, branch = cfg.get("repo", ""), cfg.get("cname", ""), cfg.get("branch", "gh-pages")
    if not repo or "/" not in repo or not cname:
        raise PublishError("settings: repo (owner/name) and cname must be set")
    if branch != PAGES_BRANCH:
        raise PublishError(f"refusing to publish to any branch but {PAGES_BRANCH}")
    private = fetch_private(cfg.get("source", "http://127.0.0.1:8787/page.json"))
    files = build(private, d, cname)
    gh = GitHub(repo, token, api)
    current = gh.current_files(branch)
    if current is not None and current == {n: git_blob_sha(b) for n, b in files.items()}:
        return "unchanged"
    gh.replace_branch(branch, files, f"snapshot {private.get('generatedAt', '')}", exists=current is not None)
    return "published"


def _kuma(env, ok, msg):
    """Report to an Uptime Kuma push URL (optional file kuma_push). Never raises, never prints the URL:
    it carries the push token."""
    d = Path(env.get("GLASSBOX_PUBLISH_DIR", "/run/glassbox-publish"))
    try:
        url = (d / "kuma_push").read_text(encoding="utf-8").strip()
    except OSError:
        return
    if not url:
        return
    if not url.startswith(("https://", "http://")) or any(c.isspace() or ord(c) < 32 for c in url):
        print("publish: kuma_push is not a valid http(s) URL", file=sys.stderr)
        return
    q = urllib.parse.urlencode({"status": "up" if ok else "down", "msg": msg})
    try:
        urllib.request.urlopen(f"{url}{'&' if '?' in url else '?'}{q}", timeout=15).close()
    except Exception:                                 # noqa: BLE001  any error text could contain the URL
        print("publish: kuma push failed", file=sys.stderr)


def main(argv=None, env=os.environ, api=API):
    ap = argparse.ArgumentParser(prog="hub.publish")
    ap.add_argument("--loop", action="store_true", help="run forever, every GLASSBOX_PUBLISH_INTERVAL seconds")
    a = ap.parse_args(argv)
    while True:
        try:
            interval = min(max(600, int(settings(env)[1].get("interval", "3600"))), 86400)  # Pages: 10 builds/hour
        except (PublishError, ValueError, OverflowError):
            interval = 3600
        try:
            result = run_once(env, api)
            print(f"publish: {result}", flush=True)
            if result != "disabled":
                _kuma(env, True, result)
            rc = 0
        except PublishError as e:
            print(f"publish failed: {e}", file=sys.stderr, flush=True)
            _kuma(env, False, "failed")
            rc = 1
        except Exception as e:                        # noqa: BLE001  never a traceback with values
            print(f"publish failed ({e.__class__.__name__})", file=sys.stderr, flush=True)
            _kuma(env, False, "error")
            rc = 1
        if not a.loop:
            return rc
        time.sleep(interval)


if __name__ == "__main__":
    sys.exit(main())
