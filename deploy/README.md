# Deploying the hub

Three containers, no published host port:

| Service | Role |
|---|---|
| `tailscale` | Sidecar. Outbound only. `tailscale serve` forwards tailnet `:443` to the hub. Node identity is kept in a volume. |
| `glassbox` | The hub (`python -m hub serve`) plus a background `collect all` loop. Shares the sidecar's network namespace (`network_mode: service:tailscale`), so it has no network of its own to expose. |
| `docker-proxy` | Read-only Docker socket proxy. Only `GET /containers/json` is allowed; every other endpoint group and every write method is refused. |

Placeholders in this directory: `<TAILNET_NAME>`, `<GITEA_URL>` and so on. Real values go only in the git-ignored files `hub.toml`, `.env` and `secrets/`.

Anything that changes the deploy machine is an external change: **ask the user before running these steps there.**

## 1. Prepare (on the deploy machine, in a clone of this repository)

```sh
cd deploy
cp hub.example.toml hub.toml        # fill in the <PLACEHOLDERS>
cp .env.example .env
mkdir -m 700 secrets
```

Create one file per secret, content only, no trailing explanation, mode 0600:

| File in `secrets/` | What | Notes |
|---|---|---|
| `ts_authkey` | Tailscale auth key | Create in the Tailscale admin console. Prefer a one-off, tagged, pre-approved key. It is only read on first start; after the node has joined, the file may contain an empty line. |
| `github_token` | GitHub fine-grained token | Read-only. Contents/Metadata read on the repositories to count, plus the profile contribution calendar. |
| `gitea_main_token`, `gitea_second_token` | One read-only Gitea token per instance | Scope `read:repository` and `read:user`. |
| `beszel_password` | Password of a read-only Beszel account | Not an admin account. |

If you use fewer Gitea instances, delete the unused `[[gitea]]` block in `hub.toml` and the matching secret in `compose.yaml`.

```sh
chmod 600 secrets/*
```

The user hands these values over separately (password manager or direct paste into the terminal). They never go in the repository, in chat logs, or in a command line that ends up in shell history.

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
docker compose exec glassbox python -m hub --config /etc/glassbox/hub.toml machine add A --role dev --os macos
docker compose exec glassbox python -m hub --config /etc/glassbox/hub.toml machine add B --role work --os windows
```

Each command prints one token on stdout, once. Only its hash is stored. Hand each token to the matching machine separately (see `docs/runbooks/install-probe.md`). Roles: `dev`, `work`, `deploy`, `gitea`. A lost token is replaced by running `machine add` again for the same id.

## 4. Verify: reachable inside the tailnet, not from the LAN or the internet

Inside the tailnet (from any device that has Tailscale and is allowed by the ACL):

```sh
curl -fsS https://glassbox.<TAILNET_NAME>.ts.net/healthz
# expect: {"ok": true}
```

Not reachable from outside:

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
4. Without a token, ingest is refused: `curl -s -X POST https://glassbox.<TAILNET_NAME>.ts.net/ingest -d '{}'` returns `{"error": "bad token"}` (HTTP 401).

## 5. Run a collector once by hand

```sh
docker compose exec glassbox python -m hub --config /etc/glassbox/hub.toml collect all
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
