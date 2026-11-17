"""Pull code activity from GitHub and Gitea into the hub store (PLAN §1, CONTRACT §2.1).

GitHub: the contribution calendar (official total), the repositories the user committed to in
the last year (with visibility), and those repositories' commits by the user. Gitea: every
repository the token can see, commits by the configured authors. Gitea repositories always
count as private. Fetches are incremental: each repository remembers its last fetch time.
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
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"null"), r.headers


def _next_link(headers):
    m = re.search(r'<([^>]+)>;\s*rel="next"', headers.get("Link") or "")
    return m.group(1) if m else None


def _since(conn, key, default_days):
    last = db.get(conn, key)
    if last:
        return datetime.fromisoformat(last) - timedelta(days=1)      # overlap one day
    return datetime.now(UTC) - timedelta(days=default_days)


# ------------------------------------------------------------------------------ GitHub
GQL = """query($from: DateTime!, $to: DateTime!) { viewer { login
  contributionsCollection(from: $from, to: $to) {
    contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    commitContributionsByRepository(maxRepositories: 100) {
      repository { nameWithOwner isPrivate url defaultBranchRef { name } } } } } }"""


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
        raise RuntimeError(f"github graphql: {res['errors'][0].get('message')}")
    viewer = res["data"]["viewer"]
    login = viewer["login"]
    cc = viewer["contributionsCollection"]
    cal = cc["contributionCalendar"]
    db.put(conn, "github.calendar", json.dumps({
        "total": cal["totalContributions"],
        "days": {d["date"]: d["contributionCount"] for w in cal["weeks"] for d in w["contributionDays"]}}))

    repos = [x["repository"] for x in cc["commitContributionsByRepository"]]
    n_commits = 0
    for repo in repos:
        nwo, private = repo["nameWithOwner"], repo["isPrivate"]
        remote = "github.com/" + nwo.lower()
        branch = (repo.get("defaultBranchRef") or {}).get("name")
        _set_visibility(conn, remote, "private" if private else "public")
        key = f"github.fetched.{nwo}"
        since = _since(conn, key, 365)
        url = (f"{api}/repos/{nwo}/commits?" +
               urllib.parse.urlencode({"author": login, "since": _zulu(since), "per_page": 100}))
        rows = []
        while url:
            try:
                page, headers = _http(url, token)
            except urllib.error.HTTPError as e:
                if e.code in (404, 409):        # gone, or an empty repository
                    break
                raise
            for c in page:
                rows.append(("github", c["sha"], _norm_t(c["commit"]["author"]["date"]), nwo.split("/")[1], remote,
                             None, branch, (c["commit"]["message"] or "").splitlines()[0] if c["commit"]["message"] else "",
                             c.get("html_url"), None, 1, 1 if private else 0))
            url = _next_link(headers)
        conn.executemany("INSERT OR REPLACE INTO commits(source, hash, t, repo, remote, project, branch, title, url, "
                         "machine, pushed, private) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        db.put(conn, key, now.isoformat())
        conn.commit()
        n_commits += len(rows)
    checked = check_visibility(conn, token, api)
    return {"repos": len(repos), "commits": n_commits, "total": cal["totalContributions"], "visibility_checked": checked}


def _set_visibility(conn, remote, vis):
    conn.execute("UPDATE projects SET visibility=?, checked=? WHERE remote=?", (vis, time.time(), remote))
    db.put(conn, f"visibility.{remote}", vis)


def check_visibility(conn, token, api="https://api.github.com", max_age=6 * 3600):
    """Projects reported by probes: GitHub remotes get their real visibility (404 = private).
    Anything not on GitHub, or without a remote, is private (PLAN §3)."""
    n = 0
    for key, remote, checked in conn.execute("SELECT key, remote, checked FROM projects").fetchall():
        if checked and time.time() - checked < max_age:
            continue
        vis = "private"
        if remote and remote.startswith("github.com/"):
            cached = db.get(conn, f"visibility.{remote}")
            if cached:
                vis = cached
            else:
                try:
                    r, _ = _http(f"{api}/repos/{remote.split('/', 1)[1]}", token)
                    vis = "private" if r.get("private") else "public"
                except urllib.error.HTTPError as e:
                    if e.code != 404:
                        raise
                db.put(conn, f"visibility.{remote}", vis)
                n += 1
        conn.execute("UPDATE projects SET visibility=?, checked=? WHERE key=?", (vis, time.time(), key))
    conn.commit()
    return n


# ------------------------------------------------------------------------------ Gitea
def gitea(conn, cfg):
    out = {}
    emails = {e.lower() for e in cfg.get("author_emails", [])}
    for g in cfg.get("gitea", []):
        token = os.environ.get(g.get("token_env", ""))
        if not token:
            print(f"gitea {g['name']}: no token in ${g.get('token_env')}", file=sys.stderr)
            continue
        base = g["url"].rstrip("/") + "/api/v1"
        host = urllib.parse.urlparse(g["url"]).hostname.lower()
        users = {g["user"].lower()}
        repos, page = [], 1
        while True:
            res, _ = _http(f"{base}/repos/search?limit=50&page={page}", token, auth="token")
            batch = (res or {}).get("data") or []
            repos += batch
            if len(batch) < 50:
                break
            page += 1
        n = 0
        for r in repos:
            full = r["full_name"]
            key = f"gitea.{g['name']}.fetched.{full}"
            since = _since(conn, key, 365)
            rows, page = [], 1
            while True:
                q = urllib.parse.urlencode({"since": _zulu(since), "limit": 50, "page": page, "stat": "false"})
                try:
                    res, _ = _http(f"{base}/repos/{full}/commits?{q}", token, auth="token")
                except urllib.error.HTTPError as e:
                    if e.code in (404, 409):
                        break
                    raise
                for c in res or []:
                    author = c.get("author") or {}
                    ce = ((c.get("commit") or {}).get("author") or {})
                    if (author.get("login") or "").lower() not in users and (ce.get("email") or "").lower() not in emails:
                        continue
                    t = _norm_t(ce.get("date") or c.get("created"))
                    if t < _zulu(since):
                        continue
                    msg = (c.get("commit") or {}).get("message") or ""
                    rows.append(("gitea", c["sha"], t, r["name"], f"{host}/{full.lower()}", None, r.get("default_branch"),
                                 msg.splitlines()[0] if msg else "", c.get("html_url"), None, 1, 1))
                if not res or len(res) < 50:
                    break
                page += 1
            conn.executemany("INSERT OR REPLACE INTO commits(source, hash, t, repo, remote, project, branch, title, url, "
                             "machine, pushed, private) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", rows)
            db.put(conn, key, datetime.now(UTC).isoformat())
            conn.commit()
            n += len(rows)
        out[g["name"]] = {"repos": len(repos), "commits": n}
    return out


def collect(conn, cfg, what="all"):
    if what in ("github", "all"):
        print("github:", github(conn, cfg))
    if what in ("gitea", "all"):
        print("gitea:", gitea(conn, cfg))
