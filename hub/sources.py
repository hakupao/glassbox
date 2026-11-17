"""Pull code activity from GitHub and Gitea into the hub store (PLAN §1, CONTRACT §2.1).

GitHub: the contribution calendar (official total), the public repositories the user committed
to in the last year (GitHub lists only those), and those repositories' default-branch commits by
the user. Gitea: the repositories the token's user can access, commits by the configured
authors. Gitea repositories always count as private.

Fetches are incremental with a 30-day overlap, because `since` filters by commit date, not push
date: a commit made locally on Monday and pushed on Friday still has Monday's date. Rewrites are
idempotent (INSERT OR REPLACE). Errors are reported as status codes only — URLs can contain
private repository names.

Known limits (CONTRACT §2.1): GitHub commits are default-branch only and at most 100 repositories;
commits on other branches or private repos still arrive through the probes' local git snapshots.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from . import db

UTC = timezone.utc
UA = "glassbox-hub"
OVERLAP = timedelta(days=30)
VIS_TTL = 6 * 3600


class RateLimited(Exception):
    pass


def _zulu(dt):
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _norm_t(s):
    return _zulu(datetime.fromisoformat(s.replace("Z", "+00:00")))


def _http(url, token=None, data=None, auth="Bearer", timeout=30):
    headers = {"User-Agent": UA, "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"{auth} {token}"
    if data is not None:
        data = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"null"), r.headers
    except urllib.error.HTTPError as e:
        if e.code == 429 or (e.code == 403 and e.headers.get("X-RateLimit-Remaining") == "0"):
            raise RateLimited(e.headers.get("X-RateLimit-Reset") or "") from None
        raise


def _next_link(headers):
    m = re.search(r'<([^>]+)>;\s*rel="next"', headers.get("Link") or "")
    return m.group(1) if m else None


def _since(conn, key, default_days):
    last = db.get(conn, key)
    if last:
        return datetime.fromisoformat(last) - OVERLAP
    return datetime.now(UTC) - timedelta(days=default_days)


INSERT = ("INSERT OR REPLACE INTO commits(source, hash, machine, t, repo, remote, project, branch, title, url, "
          "pushed, private) VALUES(?,?,'',?,?,?,NULL,?,?,?,1,?)")


def _title(msg):
    return msg.splitlines()[0] if msg else ""


# ------------------------------------------------------------------------------ GitHub
GQL = """query($from: DateTime!, $to: DateTime!) { viewer { login
  contributionsCollection(from: $from, to: $to) {
    contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    commitContributionsByRepository(maxRepositories: 100) {
      repository { nameWithOwner isPrivate defaultBranchRef { name } } } } } }"""


def github(conn, cfg):
    gh = cfg.get("github") or {}
    token = os.environ.get(gh.get("token_env", "GITHUB_TOKEN"))
    if not token:
        print("github: no token (set GITHUB_TOKEN or github.token_env)", file=sys.stderr)
        return {}
    api = gh.get("api", "https://api.github.com")
    now = datetime.now(UTC)
    res, _ = _http(api + "/graphql", token, {"query": GQL, "variables": {
        "from": _zulu(now - timedelta(days=364)), "to": _zulu(now)}})
    if res.get("errors"):
        raise RuntimeError("github graphql returned errors")
    viewer = res["data"]["viewer"]
    login = viewer["login"]
    cc = viewer["contributionsCollection"]
    cal = cc["contributionCalendar"]
    db.put(conn, "github.calendar", json.dumps({
        "total": cal["totalContributions"],
        "days": {d["date"]: d["contributionCount"] for w in cal["weeks"] for d in w["contributionDays"]}}))
    repos = [x["repository"] for x in cc["commitContributionsByRepository"]]
    if len(repos) >= 100:
        print("github: 100-repository limit reached; some repositories are not fetched", file=sys.stderr)

    n_commits, failed = 0, 0
    for repo in repos:
        nwo, private = repo["nameWithOwner"], repo["isPrivate"]
        remote = "github.com/" + nwo.lower()
        set_visibility(conn, remote, "private" if private else "public")
        branch = (repo.get("defaultBranchRef") or {}).get("name")
        key = f"github.fetched.{nwo.lower()}"
        since = _since(conn, key, 365)
        url = f"{api}/repos/{nwo}/commits?" + urllib.parse.urlencode(
            {"author": login, "since": _zulu(since), "per_page": 100})
        rows = []
        try:
            while url:
                try:
                    page, headers = _http(url, token)
                except urllib.error.HTTPError as e:
                    if e.code not in (404, 409):         # 409: empty repository
                        failed += 1
                        print(f"github: a repository fetch failed with HTTP {e.code}", file=sys.stderr)
                    break
                for c in page or []:
                    rows.append((c["sha"], _norm_t(c["commit"]["author"]["date"]), nwo.split("/")[1], remote,
                                 branch, _title(c["commit"].get("message")), c.get("html_url"), 1 if private else 0))
                url = _next_link(headers)
            else:
                db.put(conn, key, now.isoformat())
        except RateLimited:
            print("github: rate limited; stopping until the next run", file=sys.stderr)
            conn.executemany(INSERT, [("github", *r) for r in rows])
            conn.commit()
            break
        conn.executemany(INSERT, [("github", *r) for r in rows])
        conn.commit()
        n_commits += len(rows)
    try:
        checked = check_visibility(conn, token, api)
    except RateLimited:
        checked = "rate limited"
    return {"repos": len(repos), "commits": n_commits, "failed": failed, "total": cal["totalContributions"],
            "visibility_checked": checked}


def set_visibility(conn, remote, vis):
    """Visibility for a remote, applied everywhere it matters: projects, already stored commits
    and the cache. A repository that turned private is re-labelled immediately."""
    t = time.time()
    conn.execute("UPDATE projects SET visibility=?, checked=? WHERE remote=?", (vis, t, remote))
    conn.execute("UPDATE commits SET private=? WHERE remote=? AND source='github'", (0 if vis == "public" else 1, remote))
    db.put(conn, f"visibility.{remote}", json.dumps({"v": vis, "t": t}))


def _cached_visibility(conn, remote):
    raw = db.get(conn, f"visibility.{remote}")
    try:
        c = json.loads(raw) if raw else None
    except ValueError:
        return None
    return c["v"] if c and time.time() - c.get("t", 0) < VIS_TTL else None


def check_visibility(conn, token, api="https://api.github.com"):
    """Projects reported by probes get their real visibility. A GitHub remote is public only
    when the API says so; 404 or any doubt means private. Non-GitHub and remote-less: private."""
    n = 0
    for key, remote, checked in conn.execute("SELECT key, remote, checked FROM projects").fetchall():
        if checked and time.time() - checked < VIS_TTL:
            continue
        vis = "private"
        if remote and remote.startswith("github.com/"):
            vis = _cached_visibility(conn, remote)
            if vis is None:
                vis = "private"
                try:
                    r, _ = _http(f"{api}/repos/{remote.split('/', 1)[1]}", token)
                    vis = "public" if r.get("private") is False and r.get("visibility", "public") == "public" else "private"
                except urllib.error.HTTPError as e:
                    if e.code != 404:
                        print(f"github: visibility check failed with HTTP {e.code}; treating as private", file=sys.stderr)
                n += 1
                set_visibility(conn, remote, vis)
        conn.execute("UPDATE projects SET visibility=?, checked=? WHERE key=?", (vis, time.time(), key))
    conn.commit()
    return n


# ------------------------------------------------------------------------------ Gitea
def _gitea_pages(base, path, token, params):
    """Yield items page by page until an empty page (works with any MAX_RESPONSE_ITEMS)."""
    page = 1
    while True:
        q = urllib.parse.urlencode({**params, "page": page})
        res, _ = _http(f"{base}{path}?{q}", token, auth="token")
        items = res.get("data") if isinstance(res, dict) else res
        if not items:
            return
        yield from items
        page += 1
        if page > 1000:
            return


def gitea(conn, cfg):
    out = {}
    emails = {e.lower() for e in cfg.get("author_emails", [])}
    for g in cfg.get("gitea", []):
        token = os.environ.get(g.get("token_env", ""))
        if not token:
            print(f"gitea {g['name']}: no token", file=sys.stderr)
            continue
        base = g["url"].rstrip("/") + "/api/v1"
        host = (urllib.parse.urlparse(g["url"]).hostname or "").lower()
        users = {g["user"].lower()}
        try:
            repos = list(_gitea_pages(base, "/user/repos", token, {"limit": 50}))
        except urllib.error.HTTPError as e:
            print(f"gitea {g['name']}: repository list failed with HTTP {e.code}", file=sys.stderr)
            continue
        n, failed = 0, 0
        for r in repos:
            full = r["full_name"]
            key = f"gitea.{g['name']}.fetched.{full.lower()}"
            since = _since(conn, key, 365)
            rows = []
            try:
                for c in _gitea_pages(base, f"/repos/{full}/commits", token,
                                      {"since": _zulu(since), "limit": 50, "stat": "false", "files": "false"}):
                    author = c.get("author") or {}
                    ce = (c.get("commit") or {}).get("author") or {}
                    if (author.get("login") or "").lower() not in users and (ce.get("email") or "").lower() not in emails:
                        continue
                    rows.append((c["sha"], _norm_t(ce.get("date") or c.get("created")), r["name"],
                                 f"{host}/{full.lower()}", r.get("default_branch"),
                                 _title((c.get("commit") or {}).get("message")), c.get("html_url"), 1))
            except urllib.error.HTTPError as e:
                if e.code not in (404, 409):
                    failed += 1
                    print(f"gitea {g['name']}: a repository fetch failed with HTTP {e.code}", file=sys.stderr)
                continue
            except RateLimited:
                print(f"gitea {g['name']}: rate limited; stopping until the next run", file=sys.stderr)
                break
            conn.executemany(INSERT, [("gitea", *x) for x in rows])
            db.put(conn, key, datetime.now(UTC).isoformat())
            conn.commit()
            n += len(rows)
        out[g["name"]] = {"repos": len(repos), "commits": n, "failed": failed}
    return out


def collect(conn, cfg, what="all"):
    if what in ("github", "all"):
        print("github:", github(conn, cfg))
    if what in ("gitea", "all"):
        print("gitea:", gitea(conn, cfg))
