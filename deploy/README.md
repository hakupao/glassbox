# Deploying the hub

Three containers, no published host port:

| Service | Role |
|---|---|
| `tailscale` | Sidecar. Outbound only. `tailscale serve` forwards tailnet `:443` to the hub. Node identity is kept in a volume. |
| `glassbox` | The hub (`python -m hub serve`) plus a background `collect all` loop. Shares the sidecar's network namespace (`network_mode: service:tailscale`), so it has no network of its own to expose. |
| `docker-proxy` | Docker socket proxy with an exact allowlist (`wollomatic/socket-proxy`): only `GET /containers/json` (optionally `/vNN.NN/` prefixed) is forwarded; inspect, logs, exec, archive, export and all write methods answer 403, and only the sidecar's address may connect. |

**Status: written and statically checked only.** The author's machine has no Docker, so `docker compose config` and `docker compose up` have never been run. The image contains `hub/`, all of `probe/` (price table) and `design/mockups/c-v9.html` (the template; moves to `web/` later, see the comment in `Dockerfile`); without them `/` answers 500. Image parameters written from memory (socket-proxy flags and port, Tailscale health-check variables, image tags) are marked in `compose.yaml`: check them against the official documentation before deploying, and pin image digests. `read_only`, `cap_drop` and the `:ro` socket mount are also untested; the fallback for each is written next to it in `compose.yaml` or in section 5.

Placeholders in this directory: `<TAILNET_NAME>`, `<GITEA_URL>` and so on. Real values go only in the git-ignored files `hub.toml`, `.env` and `secrets/`.

Anything that changes the deploy machine is an external change: **ask the user before running these steps there.**

## 1. Prepare (on the deploy machine, in a clone of this repository)

```sh
cd deploy
cp hub.example.toml hub.toml        # fill in the <PLACEHOLDERS>
cp .env.example .env
mkdir -m 700 secrets
```

Create one file per secret, content only. The hub runs as uid 10001 with all capabilities dropped, and a bind mount keeps the host owner and mode, so a `0600` file owned by your login user is **unreadable inside the container** (the container then exits with `cannot read secret file: <name>`). Make the files readable by uid 10001:

| File in `secrets/` | What | Notes |
|---|---|---|
| `ts_authkey` | Tailscale auth key | Create in the Tailscale admin console. One-off, pre-approved and **tagged `tag:glassbox`** (section 4). Read by the sidecar (root); after the node has joined, the file may contain an empty line. |
| `github_token` | GitHub fine-grained token | Read-only. Contents/Metadata read on the repositories to count, plus the profile contribution calendar. |
| `gitea_main_token`, `gitea_second_token` | One read-only Gitea token per instance | Scope `read:repository` and `read:user`. |
| `beszel_password` | Password of a read-only Beszel account | Not an admin account. |

If you use fewer Gitea instances, delete the unused `[[gitea]]` block in `hub.toml` and the matching secret in `compose.yaml`.

```sh
sudo chown 10001:10001 secrets/*
sudo chmod 400 secrets/*
sudo chown root:root secrets/ts_authkey     # only the sidecar (root) reads this one
```

Without sudo: keep `secrets/` at mode 0700 and the files at 0444; the directory then protects them on the host. Type secret values with the terminal echo off (`(umask 077; stty -echo; read -r V; stty echo; printf '%s' "$V" > secrets/NAME)`), never as a command-line argument.

The user hands these values over separately (password manager or direct paste into the terminal). They never go in the repository, in chat logs, or in a command line that ends up in shell history.

After the first start, check that every secret was loaded (prints variable names only, never values):

```sh
docker compose exec glassbox glassbox-entrypoint check-secrets
# expect: GITHUB_TOKEN: set, GITEA_MAIN_TOKEN: set, GITEA_SECOND_TOKEN: set, BESZEL_PASSWORD: set
```

An unreadable or empty secret file makes the container exit at start (see `docker compose logs glassbox`); it never runs degraded.

`docker compose exec glassbox glassbox-entrypoint <args>` runs `python -m hub --config /etc/glassbox/hub.toml <args>` with the secrets in its environment. A plain `docker compose exec glassbox python -m hub ...` would not have them.

## 2. Start from an empty database

The hub refuses a database whose `schema_version` differs from the code (`hub/db.py`), so never copy a development database here. The volume `glassbox-data` starts empty, which is correct.

```sh
docker compose up -d --build
docker compose ps                    # all three: running; glassbox: healthy after ~30 s
docker compose logs glassbox | tail  # expect: "glassbox hub listening on http://127.0.0.1:8787/"
```

If the log says `hub database schema ... != ...`, the volume holds an old database: stop, archive the volume (do not delete it blindly), and start with a new one.

## 3. Register the machines and hand out tokens

```sh
(umask 077; docker compose exec -T glassbox glassbox-entrypoint machine add A --role dev --os macos > secrets/token-A.txt)
(umask 077; docker compose exec -T glassbox glassbox-entrypoint machine add B --role work --os windows > secrets/token-B.txt)
```

Each command prints one token on stdout, once; the redirect keeps it off the terminal. Only its hash is stored. **The user should run these commands themselves**: a token printed in an agent's terminal lands in that agent's session transcript. The files are created with mode 0600 from the start (the `umask` in the subshell) and live in the git-ignored `secrets/` directory (`token-*.txt` is also ignored). Delete `secrets/token-*.txt` after handing the tokens over. Hand each token to the matching machine separately (see `docs/runbooks/install-probe.md`). Roles: `dev`, `work`, `deploy`, `gitea`. A lost token is replaced by running `machine add` again for the same id.

## 4. Restrict the tailnet ACL

The sidecar runs Tailscale in userspace mode. Without an ACL, any tailnet member could also connect to the hub's plain-HTTP port 8787 directly, bypassing `tailscale serve`. Tag the node and allow only port 443 to it. In the Tailscale admin console, policy file (merge into the existing policy; do not replace it):

```json
{
  "tagOwners": { "tag:glassbox": ["autogroup:admin"] },
  "acls": [
    { "action": "accept", "src": ["<ALLOWED_USERS_OR_GROUP>"], "dst": ["tag:glassbox:443"] }
  ]
}
```

**Security note: the hub's pages `/` and `/page.json` have no authentication.** The only protection is that the hub listens inside the tailnet and the ACL lets only your own devices reach `tag:glassbox:443`. Anything that can reach that port sees the full private view (project names, repositories, machines). Keep `<ALLOWED_USERS_OR_GROUP>` to your own devices and never enable Tailscale Funnel or share the node. (`/ingest` is separately protected by per-machine tokens.)

Changing the tailnet policy is an external change: **ask the user first.** Tagged nodes do not expire their key; that is expected here. The auth key (`secrets/ts_authkey`) must be created with the tag `tag:glassbox`, and `.env` must carry `TS_EXTRA_ARGS=--advertise-tags=tag:glassbox` (the example does).

Also pick up `docker compose restart glassbox` whenever the `tailscale` container is restarted by hand, if `depends_on ... restart: true` did not already do it: the hub is attached to the sidecar's network namespace, which is replaced when the sidecar is recreated.

## 5. Verify: reachable inside the tailnet, not from the LAN or the internet

Inside the tailnet (from any device that has Tailscale and is allowed by the ACL):

```sh
curl -fsS https://glassbox.<TAILNET_NAME>.ts.net/healthz
# expect: {"ok": true}
```

Not reachable from outside (and the exposure rules hold):

1. Nothing is published on the host. On the deploy machine:
   ```sh
   docker compose ps --format '{{.Name}} {{.Ports}}'
   # expect: no "0.0.0.0:" or ":::" entries (Ports empty for all three)
   docker compose config | grep -c '^\s*ports:'     # expect: 0
   ```
2. Not on the LAN. From another LAN device that is **not** on the tailnet (or with Tailscale switched off), try the deploy machine's LAN address on the common ports and the hub port:
   ```sh
   curl -m 5 http://<DEPLOY_LAN_IP>:8787/healthz     # expect: connection refused or timeout
   curl -m 5 -k https://<DEPLOY_LAN_IP>/healthz      # expect: not the glassbox response
   ```
3. Not on the internet. The node must not be in Funnel: `docker compose exec tailscale tailscale funnel status` should say funnel is off, and `https://glassbox.<TAILNET_NAME>.ts.net/healthz` must time out from a device without Tailscale (for example a phone on mobile data).
4. Plain-HTTP hub port closed to the tailnet. From a second tailnet device: `curl -m 5 http://glassbox.<TAILNET_NAME>.ts.net:8787/healthz` must fail (timeout or refused). If it answers, the ACL in section 4 is not in force.
5. Docker proxy allows only the listing. From the hub container's namespace (no values printed):
   ```sh
   docker compose exec glassbox python -c "import urllib.request as u,urllib.error as e
for p in ('/containers/json?all=1','/containers/x/json','/containers/x/logs','/info'):
    try: print(p, u.urlopen('http://docker-proxy:2375'+p, timeout=5).status)
    except e.HTTPError as x: print(p, x.code)"
   # expect: first path 200, the other three 403 (a 404 for /containers/x/json means the proxy let it through: fix the allowlist)
   ```
   If `docker-proxy` does not start with `read_only`/`cap_drop`, remove `read_only` first, then `cap_drop`, and note which one was needed.
6. Without a token, ingest is refused: `curl -s -X POST https://glassbox.<TAILNET_NAME>.ts.net/ingest -d '{}'` returns `{"error": "bad token"}` (HTTP 401).

## 6. Run a collector once by hand

```sh
docker compose exec glassbox glassbox-entrypoint collect all
# expect lines for github, gitea and "monitors:" with beszel/kuma/docker/tailscale counts, not "error"
```

Per-source meaning: `skipped` = not configured, `error` = see the source section of `hub/monitors.py`. A failing source does not stop the others.

Before trusting Gitea numbers, confirm the organisation repositories of both instances are listed (the collector asks `/user/repos`); see the follow-up in `docs/runbooks/deploy-hub.md`.

## Backups

Include the volume `glassbox-data` (sqlite, WAL mode) in the host's backup. For a consistent copy of a WAL database, stop the glassbox service briefly (`docker compose stop glassbox`) before copying, then start it again.

## Updating

```sh
git pull && docker compose up -d --build
```

A change of `SCHEMA_VERSION` in `hub/db.py` needs a new database (the hub says so and exits).
