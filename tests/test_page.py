"""hub/page.py: glassbox.page/1 from the hub store (CONTRACT §2, §2.1), on fabricated data."""
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path

from hub import db, page, server

UTC = timezone.utc
NOW = datetime(2026, 11, 17, 2, 0, tzinfo=UTC)            # 11:00 in Asia/Tokyo
CFG = {"tz": "Asia/Tokyo"}
H = "a" * 40


def usage(conn, hour, n, agent="claude-code", model="claude-opus-5-5", project="p_pub", cost=None, machine="A"):
    conn.execute("INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                 (machine, hour, agent, model, project, n, 0 if cost is not None or n == 0 else n,
                  n, 2 * n, 10 * n, n, 0, cost))


def commit(conn, source, h, t, machine="", repo="demo", remote="github.com/me/demo", project=None, pushed=1,
           private=0, url=None):
    conn.execute("INSERT INTO commits VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                 (source, h, machine, t, repo, remote, project, "main", f"feat: {h[:4]}", url, pushed, private))


class PageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = db.connect(Path(self.tmp.name) / "hub.sqlite")
        c = self.conn
        c.execute("INSERT INTO projects(key, name, remote, visibility) VALUES('p_pub', 'demo', 'github.com/me/demo', 'public')")
        c.execute("INSERT INTO projects(key, name, remote, visibility) VALUES('p_loc', 'notebook', NULL, NULL)")

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def build(self, cfg=CFG):
        return page.build(self.conn, cfg, NOW)

    # ---- days are cut in the hub's zone
    def test_day_cut_uses_hub_time_zone(self):
        usage(self.conn, "2026-11-16T14:00:00Z", 5, cost=0.5)     # 23:00 on the 16th, local
        usage(self.conn, "2026-11-16T15:00:00Z", 7, cost=0.7)     # 00:00 on the 17th, local
        usage(self.conn, "2026-11-17T01:00:00Z", 3, agent="codex", model="gpt-6-astra", cost=None)
        self.conn.execute("INSERT INTO sessions VALUES('A', '2026-11-16T14:00:00Z', 'claude-code', 'p_pub', 2)")
        self.conn.execute("INSERT INTO sessions VALUES('A', '2026-11-16T15:00:00Z', 'claude-code', 'p_pub', 1)")
        p = self.build()
        t = p["today"]
        self.assertEqual((t["requests"], t["sessions"], t["unpricedRequests"]), (10, 1, 3))
        self.assertAlmostEqual(t["costUsd"], 0.7)
        self.assertEqual(t["hourly"][0], {"hour": 0, "requests": 7, "costUsd": 0.7})
        self.assertEqual(t["hourly"][10]["requests"], 3)
        self.assertEqual(len(t["hourly"]), 24)
        models = {m["model"]: m["costUsd"] for m in t["byModel"]}
        self.assertEqual(models, {"claude-opus-5-5": 0.7, "gpt-6-astra": None})   # null only when nothing is priced
        self.assertEqual(t["byProject"], [{"project": "demo", "public": True, "requests": 10, "costUsd": 0.7}])
        self.assertEqual(p["trend"][-2], {"date": "2026-11-16", "costUsd": {"claude-code": 0.5, "codex": 0.0}})
        d16 = next(d for d in p["usageDays"] if d["date"] == "2026-11-16")
        self.assertEqual((d16["requests"], d16["sessions"]), (5, 2))
        self.assertEqual(t["cacheHitRate"], round(100 / (10 + 100 + 10), 4))

    def test_rejects_zone_without_whole_hour_offset(self):
        with self.assertRaises(ValueError):
            self.build({"tz": "Asia/Kolkata"})

    def test_trend_is_30_days_ending_today_and_equal_to_today(self):
        usage(self.conn, "2026-11-17T00:00:00Z", 4, cost=1.25)
        usage(self.conn, "2026-11-17T00:00:00Z", 2, agent="codex", model="gpt-6-astra", cost=0.5)
        usage(self.conn, "2026-10-01T00:00:00Z", 9, cost=9.0)        # older than the trend
        p = self.build()
        tr = p["trend"]
        self.assertEqual(len(tr), 30)
        self.assertEqual(tr[-1]["date"], "2026-11-17")
        self.assertEqual(tr[0]["date"], "2026-10-19")
        self.assertTrue(all(set(d["costUsd"]) == {"claude-code", "codex"} for d in tr))
        by = {a["agent"]: a["costUsd"] for a in p["today"]["byAgent"]}
        self.assertEqual(tr[-1]["costUsd"], by)
        self.assertAlmostEqual(sum(tr[-1]["costUsd"].values()), p["today"]["costUsd"])
        self.assertEqual(p["usageDays"][-1]["date"], "2026-11-17")
        self.assertEqual(sum(d["requests"] for d in p["usageDays"]), 15)

    def test_empty_store_still_gives_a_complete_page(self):
        p = self.build()
        self.assertEqual(p["today"]["requests"], 0)
        self.assertEqual(p["trend"][-1], {"date": "2026-11-17", "costUsd": {"claude-code": 0.0, "codex": 0.0}})
        for k in ("quota", "activity", "machines", "services", "runtimes", "tailnet", "jobs", "hidden"):
            self.assertEqual(p[k], [], k)

    # ---- code activity
    def test_commits_dedup_by_hash_with_source_priority(self):
        c = self.conn
        b, g, l1, l2, l3 = "b" * 40, "c" * 40, "d" * 40, "e" * 40, "f" * 40
        commit(c, "github", H, "2026-11-16T01:00:00Z", url="https://github.com/me/demo/commit/" + H)
        commit(c, "local", H, "2026-11-16T01:00:00Z", machine="B", project="p_pub")      # same commit, pushed
        commit(c, "gitea", g, "2026-11-16T02:00:00Z", repo="app", remote="gitea.test/team/app", private=1)
        commit(c, "local", g, "2026-11-16T02:00:00Z", machine="A", repo="app", remote="gitea.test/team/app", pushed=0)
        commit(c, "local", l1, "2026-11-16T03:00:00Z", machine="A", project="p_pub")       # pushed, no collector has it: local fallback
        commit(c, "local", l2, "2026-11-16T04:00:00Z", machine="A", project="p_pub", pushed=0)
        commit(c, "local", l3, "2026-11-16T05:00:00Z", machine="A", repo="notebook", remote=None, project="p_loc")
        commit(c, "github", b, "2025-11-15T00:00:00Z")                                      # before the window
        p = self.build()
        act = p["activity"]
        self.assertEqual([a["hash"] for a in act], [l3, l2, l1, g, H])
        self.assertEqual(sum(a["hash"] == H for a in act), 1)                              # github copy only
        top = {a["hash"]: a for a in act}
        self.assertEqual((top[H]["source"], top[H]["machine"], top[H]["public"], top[H]["pushed"]), ("github", "B", True, True))
        self.assertEqual((top[g]["source"], top[g]["public"], top[g]["machine"]), ("gitea", False, "A"))
        self.assertEqual((top[l2]["source"], top[l2]["pushed"], top[l2]["public"], top[l2]["url"]), ("local", False, True, None))
        self.assertEqual((top[l3]["public"], top[l3]["pushed"]), (False, True))         # no remote: private
        self.assertEqual((top[l1]["source"], top[l1]["pushed"], top[l1]["machine"], top[l1]["url"]), ("local", True, "A", None))
        self.assertEqual(top[H]["t"], "2026-11-16T10:00:00+09:00")
        cont = p["contributions"]
        self.assertEqual(cont["total"], 5)
        self.assertEqual(cont["total"], sum(d["count"] for d in cont["days"]))
        self.assertEqual(cont["days"][0]["date"], "2025-11-16")
        self.assertEqual(date.fromisoformat(cont["days"][0]["date"]).isoweekday(), 7)     # a Sunday
        self.assertEqual(cont["days"][-1]["date"], "2026-11-17")
        self.assertEqual(next(d for d in cont["days"] if d["date"] == "2026-11-16")["count"], 5)
        repos = {r["repo"]: r for r in p["code"]["repos"]}
        self.assertEqual((repos["demo"]["commits"], repos["demo"]["unpushed"], repos["demo"]["sources"]), (3, 1, ["github", "local"]))
        self.assertEqual(len(p["code"]["commits"]), 5)

    def test_activity_is_capped_newest_first(self):
        for i in range(60):
            commit(self.conn, "github", f"{i:040x}", f"2026-11-{1 + i // 10:02d}T{i % 10:02d}:00:00Z")
        act = self.build()["activity"]
        self.assertEqual(len(act), 50)
        self.assertEqual(act, sorted(act, key=lambda a: a["t"], reverse=True))

    # ---- services: container + monitor merged into one row
    def test_services_merge_container_and_monitor(self):
        c = self.conn
        c.execute("INSERT INTO container_stats VALUES('V', 'web-app', 1.5, 100.0)")
        c.execute("INSERT INTO container_state VALUES('V', 'web-app', 'up')")
        c.execute("INSERT INTO container_stats VALUES('V', 'db', 0.5, 50.0)")
        c.execute("INSERT INTO container_state VALUES('V', 'worker', 'down')")
        c.execute("INSERT INTO container_stats VALUES('V', 'cache', 0.1, 10.0)")
        c.execute("INSERT INTO monitors VALUES('1', 'Web App', 'V', 'up', 99.5)")         # same name, normalized
        c.execute("INSERT INTO monitors VALUES('2', 'Database :5432', 'V', 'up', 100.0)") # via [services.merge]
        c.execute("INSERT INTO monitors VALUES('3', 'Worker', 'V', 'up', 98.0)")          # container is down
        c.execute("INSERT INTO monitors VALUES('4', 'External site', 'V', 'down', 50.0)")
        p = self.build({**CFG, "services": {"merge": {"Database :5432": "db"}}})
        s = {r["name"]: r for r in p["services"]}
        self.assertEqual(len(p["services"]), 5)
        self.assertEqual(s["Web App"], {"name": "Web App", "kind": "both", "machine": "V", "status": "up",
                                        "uptimePct24h": 99.5, "cpuPct": 1.5, "memBytes": 100.0})
        self.assertEqual((s["Database :5432"]["kind"], s["Database :5432"]["cpuPct"]), ("both", 0.5))
        self.assertEqual((s["Worker"]["kind"], s["Worker"]["status"]), ("both", "down"))
        self.assertEqual((s["External site"]["kind"], s["External site"]["status"]), ("monitor", "down"))
        self.assertEqual((s["cache"]["kind"], s["cache"]["status"], s["cache"]["uptimePct24h"]), ("container", "up", None))
        self.assertNotIn("db", s)
        self.assertNotIn("web-app", s)

    # ---- machines, runtimes, quota
    def test_runtimes_stale_after_15_minutes_offline(self):
        c, t = self.conn, NOW.timestamp()
        c.execute("INSERT INTO machines(id, role, os, last_report) VALUES('A', 'dev', 'macos', ?)", (t - 60,))
        c.execute("INSERT INTO machines(id, role, os, last_report) VALUES('B', 'work', 'windows', ?)", (t - 16 * 60,))
        for m in ("A", "B", "X"):
            c.execute("INSERT INTO runtimes VALUES(?, 'claude-code', '2.1.0', 1, 1, ?)", (m, t))
        p = self.build()
        self.assertEqual({r["machine"]: r["stale"] for r in p["runtimes"]}, {"A": False, "B": True, "X": True})
        m = {x["id"]: x for x in p["machines"]}
        self.assertEqual((m["A"]["online"], m["B"]["online"]), (True, False))
        self.assertIsNone(m["A"]["system"])
        self.assertEqual(m["B"]["probeLastReport"], "2026-11-17T10:44:00+09:00")

    def test_machines_join_beszel_and_config(self):
        c, t = self.conn, NOW.timestamp()
        c.execute("INSERT INTO machine_state VALUES('C', 'up', 3600, ?)", (t - 30,))
        c.execute("INSERT INTO machine_stats VALUES('C', '2026-11-16T01:00:00Z', 9, 1, 2, 3, 4)")   # older than 24h
        c.execute("INSERT INTO machine_stats VALUES('C', '2026-11-17T01:40:00Z', 5.5, 4e9, 8e9, 1e11, 4e11)")
        p = self.build({**CFG, "machines": {"C": {"role": "deploy", "os": "linux"}}})
        (m,) = p["machines"]
        self.assertEqual((m["id"], m["role"], m["os"], m["online"], m["label"]), ("C", "deploy", "linux", True, "C"))
        self.assertEqual(m["system"], {"cpuPct": 5.5, "memUsed": 4e9, "memTotal": 8e9, "diskUsed": 1e11,
                                       "diskTotal": 4e11, "uptimeSec": 3600})
        self.assertEqual(m["history"], [{"t": "2026-11-17T10:40:00+09:00", "cpuPct": 5.5, "memPct": 50.0, "diskPct": 25.0}])

    def test_quota_latest_sample_with_window_history(self):
        c = self.conn
        rows = [("2026-11-10T00:00:00Z", 90, "2026-11-12T00:00:00Z"),       # previous window
                ("2026-11-15T00:00:00Z", 10, "2026-11-20T00:00:00Z"),
                ("2026-11-17T01:00:00Z", 30, "2026-11-20T00:00:00Z")]
        for t, pct, reset in rows:
            c.execute("INSERT INTO quota VALUES('a_1', 'claude-code', '7d', ?, ?, ?, 'A')", (t, pct, reset))
        c.execute("INSERT INTO quota VALUES('a_2', 'codex', '5h', '2026-11-17T01:00:00Z', 5, '2026-11-17T04:00:00Z', 'A')")
        p = self.build({**CFG, "accounts": {"a_1": "K"}})
        q = {(x["account"], x["window"]): x for x in p["quota"]}
        k = q[("K", "7d")]
        self.assertEqual((k["usedPct"], k["resetsAt"], k["sampledAt"]), (30, "2026-11-20T09:00:00+09:00", "2026-11-17T10:00:00+09:00"))
        self.assertEqual([h["usedPct"] for h in k["history"]], [10, 30])
        self.assertIn(("a_2", "5h"), q)                                       # unnamed: hash in the private view
        self.assertTrue(any(w["kind"] == "unnamed-account" for w in p["warnings"]))

    # ---- serving the private view
    def test_html_inlines_data_safely(self):
        tpl = '<html><script id="gb-data"></script><script>go()</script></html>'
        out = page.html({"title": "</script><b>x"}, tpl)
        self.assertNotIn("</script><b>", out)
        self.assertIn('<script>window.GB = {"title": "\\u003c/script>', out)
        with self.assertRaises(ValueError):
            page.html({}, "<html></html>")

    def test_server_serves_page_and_private_view(self):
        usage(self.conn, "2026-11-17T00:00:00Z", 4, cost=1.0)
        self.conn.commit()
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(server.Hub(self.conn, CFG)))
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            base = f"http://127.0.0.1:{httpd.server_address[1]}"
            with urllib.request.urlopen(base + "/page.json", timeout=10) as r:
                p = json.loads(r.read())
            self.assertEqual((p["schema"], p["view"]), ("glassbox.page/1", "private"))
            with urllib.request.urlopen(base + "/", timeout=10) as r:
                body = r.read().decode("utf-8")
                self.assertTrue(r.headers["Content-Type"].startswith("text/html"))
            self.assertEqual(body.count("<script>window.GB = "), 1)
            self.assertNotIn(page.MARKER, body)
            self.assertNotIn("mockups", body)
            self.assertTrue(body.split("<head>", 1)[1].lstrip().startswith(page.CSP))
            self.assertNotRegex(body, r"<script[^>]*\bsrc=|<link\b")
        finally:
            httpd.shutdown()
            httpd.server_close()

    # ---- review follow-ups
    def test_zone_checks_every_offset_of_the_year(self):
        self.assertEqual(str(page.zone({"tz": "America/New_York"}, NOW)), "America/New_York")   # DST, whole hours
        with self.assertRaises(ValueError):
            page.zone({"tz": "Australia/Lord_Howe"}, NOW)       # +10:30 / +11:00
        with self.assertRaises(ValueError):                       # whole hour now, +10:30 half a year later
            page.zone({"tz": "Australia/Lord_Howe"}, datetime(2026, 1, 15, tzinfo=UTC))

    def test_null_token_columns_count_as_zero(self):
        self.conn.execute("INSERT INTO usage VALUES('A', '2026-11-17T00:00:00Z', 'claude-code', 'm', 'p_pub', "
                          "2, 0, 5, NULL, NULL, 1, NULL, 0.1)")
        t = self.build()["today"]
        self.assertEqual(t["tokens"], {"input": 5, "output": 0, "cacheRead": 0, "cacheWrite": 1, "reasoning": 0})

    def test_repos_group_by_remote_not_name(self):
        commit(self.conn, "github", "1" * 40, "2026-11-16T01:00:00Z", repo="Demo")
        commit(self.conn, "local", "2" * 40, "2026-11-16T02:00:00Z", machine="A", repo="demo", project="p_pub")
        (r,) = self.build()["code"]["repos"]
        self.assertEqual((r["commits"], r["sources"]), (2, ["github", "local"]))

    def test_monitor_without_machine_merges_only_a_unique_name(self):
        c = self.conn
        c.execute("INSERT INTO container_stats VALUES('C', 'web', 1.0, 10.0)")
        c.execute("INSERT INTO container_stats VALUES('V', 'web', 2.0, 20.0)")
        c.execute("INSERT INTO container_stats VALUES('V', 'db', 3.0, 30.0)")
        c.execute("INSERT INTO monitors VALUES('1', 'web', NULL, 'up', 100.0)")    # two machines have 'web'
        c.execute("INSERT INTO monitors VALUES('2', 'db', NULL, 'up', 99.0)")      # unique
        rows = {(r["name"], r["machine"]): r["kind"] for r in self.build()["services"]}
        self.assertEqual(rows, {("web", None): "monitor", ("web", "C"): "container", ("web", "V"): "container",
                                ("db", "V"): "both"})

    def test_quota_history_window_boundary(self):
        c = self.conn
        for t, pct in (("2026-11-13T00:59:59Z", 1), ("2026-11-13T01:00:00Z", 2), ("2026-11-17T01:00:00Z", 3)):
            c.execute("INSERT INTO quota VALUES('a_1', 'claude-code', '7d', ?, ?, '2026-11-20T01:00:00Z', 'A')", (t, pct))
        (q,) = self.build()["quota"]
        self.assertEqual(q["usedPct"], 3)
        self.assertEqual([h["usedPct"] for h in q["history"]], [2, 3])   # window start is inclusive

    def test_html_escapes_line_separators(self):
        out = page.html({"title": "a b c"}, page.MARKER)
        self.assertNotIn(" ", out)
        self.assertNotIn(" ", out)
        self.assertIn("a\\u2028b\\u2029c", out)

    def test_private_view_checks_host_and_ingest_still_needs_a_token(self):
        cfg = {**CFG, "serve": {"hosts": ["glassbox.example.ts.net"]}}
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(server.Hub(self.conn, cfg)))
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        port = httpd.server_address[1]

        def get(path, host):
            req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", headers={"Host": host})
            try:
                with urllib.request.urlopen(req, timeout=10) as r:
                    return r.status
            except urllib.error.HTTPError as e:
                return e.code
        try:
            for host in (f"127.0.0.1:{port}", "localhost", f"[::1]:{port}", "GLASSBOX.example.ts.net:443"):
                self.assertEqual(get("/page.json", host), 200, host)
            for host in ("attacker.example", f"attacker.example:{port}", "", "127.0.0.1.attacker.example"):
                self.assertEqual(get("/page.json", host), 421, host)
                self.assertEqual(get("/", host), 421, host)
            self.assertEqual(get("/healthz", "attacker.example"), 200)
            req = urllib.request.Request(f"http://127.0.0.1:{port}/ingest", data=b"{}", method="POST")
            with self.assertRaises(urllib.error.HTTPError) as e:
                urllib.request.urlopen(req, timeout=10)
            self.assertEqual(e.exception.code, 401)
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_serve_hosts_must_be_a_list(self):
        self.assertEqual(server.serve_hosts({"serve": {"hosts": ["A.example.ts.net "]}}), {"a.example.ts.net"})
        self.assertEqual(server.serve_hosts({}), set())
        for bad in ("glassbox.example.ts.net", [""], [1], {"a": 1}):
            with self.assertRaises(ValueError, msg=repr(bad)):
                server.Hub(self.conn, {**CFG, "serve": {"hosts": bad}})

    def test_no_static_files_are_served(self):
        # The page is one inlined document (CSP: inline only); web/ files are not routes.
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(server.Hub(self.conn, CFG)))
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        port = httpd.server_address[1]
        try:
            for path in ("/app.js", "/styles.css", "/i18n.js", "/../hub/server.py", "/%2e%2e/hub/server.py", "//etc/passwd"):
                with self.assertRaises(urllib.error.HTTPError, msg=path) as e:
                    urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=10)
                self.assertEqual(e.exception.code, 404, path)
        finally:
            httpd.shutdown()
            httpd.server_close()


if __name__ == "__main__":
    unittest.main()
