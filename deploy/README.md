# Deploying the hub

Three containers, no published host port:

| Service (container) | Role |
|---|---|
| `tailscale` (`glassbox-tailscale`) | Sidecar. Outbound only. `tailscale serve` forwards tailnet `:443` to the hub. Node identity is kept in the volume `glassbox_tailscale-state`. |
| `glassbox` (`glassbox`) | The hub (`python -m hub serve`) plus a background `collect all` loop. Shares the sidecar's network namespace (`network_mode: service:tailscale`), so it has no network of its own to expose. Data in the volume `glassbox_glassbox-data`. |
| `docker-proxy` (`glassbox-docker-proxy`) | Docker socket proxy with an exact allowlist (`wollomatic/socket-proxy`): only `GET /containers/json` (optionally `/vNN.NN/` prefixed) is forwarded; inspect, logs, exec, archive, export and all write methods answer 403, and only the sidecar's address may connect. |

## How a deploy works

Push to `main` (changes under `deploy/`, `hub/`, `probe/`, `web/`, `schema/` or the workflow file) runs `.gitea/workflows/glassbox.yml` on the runner in the deploy VM, which uses the VM's own Docker daemon:

1. check the repository variables, pick the tag (the commit SHA);
2. **preflight**: `/opt/glassbox` must contain every required file, readable by uid 10001; otherwise the workflow stops with a message and deploys nothing (this is what prevents a crash loop on the first push);
3. log in to the Gitea registry with `secrets.REGISTRY_TOKEN`, build, push;
4. pull, `docker compose -f deploy/compose.yaml up -d`;
5. health checks through `docker exec glassbox` (nothing is published on the host), the Host-allowlist check, and the no-published-ports / no-routes check.

Only `REGISTRY_TOKEN` passes through CI. Every runtime token (GitHub, Gitea, Beszel, Tailscale auth key) is a file the user puts on the VM by hand.

**Status: written and statically checked only.** The author's machine has no Docker: `docker compose config`, the workflow and the containers have never been run. The image contains `hub/`, all of `probe/` (price table) and `web/` (bundled into one inlined page at request time); without them `/` answers 500. Parameters written from memory (socket-proxy flags and port, Tailscale health-check variables, image tags, the preflight image tag) are marked in `compose.yaml` and the workflow: check them against the official documentation before the first deploy, and pin image digests. `read_only`, `cap_drop` and the `:ro` mounts are untested; the fallback for each is next to it in `compose.yaml` or in section 5 (item 9).

Placeholders: `<TAILNET_NAME>`, `<NODE>`, `<REGISTRY>`, `<OWNER>` and so on. Real values go only in the Gitea repository variables and in `/opt/glassbox` on the VM.

Everything below that changes the VM or Gitea is an external change: **ask the user first, and the user runs the commands that handle secrets.**

## 1. One-time VM preparation (the user runs these)

Layout of `/opt/glassbox` (bind-mounted read-only into the containers; compose never creates it):

| Path | Content | Owner / mode | Read by |
|---|---|---|---|
| `/opt/glassbox` | directory | `root:10001` `0750` | hub (uid 10001) |
| `hub.toml` | copy of `deploy/hub.example.toml`, placeholders filled in; includes `[serve] hosts = ["<NODE>.<TAILNET_NAME>.ts.net"]` | `root:10001` `0640` | hub |
| `serve.json` | copy of `deploy/serve.json` (no `AllowFunnel`) | `root:root` `0644` | sidecar |
| `ts_authkey` | Tailscale auth key: one-off, pre-approved, tagged `tag:glassbox` | `root:root` `0600` | sidecar (root) |
| `secrets/` | directory | `root:10001` `0750` | hub |
| `secrets/github_token` | GitHub fine-grained read-only token (Contents/Metadata read, plus the profile contribution calendar) | `root:10001` `0640` | hub |
| `secrets/gitea_main_token` | read-only Gitea token (`read:repository`, `read:user`) | `root:10001` `0640` | hub |
| `secrets/beszel_password` | password of a read-only Beszel account (not an admin) | `root:10001` `0640` | hub |

The hub runs as uid 10001 with all capabilities dropped and bind mounts keep the host owner and mode, so a `0600` file owned by your login user is **unreadable in the container**; the container then exits with `cannot read secret file: <name>` (it never runs degraded). `root:10001` with `0640` is the minimum that works. `ts_authkey` is kept outside `secrets/` on purpose: the entrypoint turns every file in `secrets/` into an environment variable of the hub, and the hub must not have the auth key. After the node has joined, `ts_authkey` may be an empty file (the bind mount needs the file to exist). There is a single Gitea instance. To add a second, add a `[[gitea]]` block to `hub.toml`, its token file under `secrets/`, and the file name to the workflow's preflight list.

```sh
sudo install -d -o root -g 10001 -m 0750 /opt/glassbox /opt/glassbox/secrets
sudo install -o root -g 10001 -m 0640 deploy/hub.example.toml /opt/glassbox/hub.toml   # then edit it
sudo install -o root -g root  -m 0644 deploy/serve.json /opt/glassbox/serve.json
sudo install -o root -g root  -m 0600 /dev/null /opt/glassbox/ts_authkey
sudo install -o root -g 10001 -m 0640 /dev/null /opt/glassbox/secrets/github_token
# repeat the last line for gitea_main_token and beszel_password
```

Fill each secret file by typing the value with echo off, never as a command-line argument and never through an agent:

```sh
read -rs -p 'value: ' V; echo; printf '%s' "$V" | sudo tee /opt/glassbox/secrets/github_token >/dev/null; unset V
```

(Use the same pattern for `ts_authkey`.) Edit `hub.toml` with `sudoedit`. Addresses in it (Gitea, Beszel, Kuma) must be IPs or names the container's own resolver can resolve; tailnet and `.local` names do not resolve there (see the comment in the file).

**Verify** (prints no values):

```sh
sudo ls -ln /opt/glassbox /opt/glassbox/secrets          # owners/modes as in the table
sudo -u '#10001' -g '#10001' test -r /opt/glassbox/secrets/github_token && echo readable-by-10001
sudo grep -c AllowFunnel /opt/glassbox/serve.json         # expect: 0
sudo grep -n '^\[serve\]' /opt/glassbox/hub.toml          # expect: one line
```

Also, once, on the VM: add `glassbox_glassbox-data` to the backup (sqlite in WAL mode: stop `glassbox` briefly before copying, or use a tool that snapshots the volume). The data is in a named volume, not on the shared host folder, because WAL needs real file locks and fsync.

## 2. Gitea repository settings

Repository Settings, Actions:

| Kind | Name | Value |
|---|---|---|
| Variable | `REGISTRY` | registry host (with port if any) |
| Variable | `IMAGE` | full image path without tag, `<REGISTRY>/<OWNER>/glassbox` |
| Secret | `REGISTRY_TOKEN` | a Gitea token with package write scope for the registry |

No other secret is needed or allowed (a test fails if the workflow reads any other). The Tailscale ACL and tag (section 4, ACL part) must also be in place before the node is brought up.

## 3. First deploy

1. Sections 1, 2 and 4 (ACL part) are done.
2. Push to `main`, or run the workflow by hand (Actions, glassbox, Run workflow, branch `main`, tag empty).
3. Watch the run. A failed **预检** step lists the missing files; fix them and re-run. Nothing was deployed in that case.
4. The first start begins with an **empty database**: the hub refuses a database whose `schema_version` differs from the code (`hub/db.py`), so never put a development database into the volume. If the hub log says `hub database schema ... != ...`, stop the stack, archive the volume (do not delete it blindly) and start with a new one.

```sh
docker ps --filter label=com.docker.compose.project=glassbox --format '{{.Names}} {{.Status}} {{.Ports}}'
docker logs glassbox | tail     # expect: "glassbox hub listening on http://127.0.0.1:8787/"
```

## 4. Register machines, and restrict the tailnet ACL

**Machines and tokens (the user runs these).** The token is printed once on stdout; redirect it so it never reaches a terminal an agent can read, and create the file private from the start:

```sh
mkdir -p -m 700 ~/glassbox-tokens
(umask 077; docker exec glassbox glassbox-entrypoint machine add A --role dev --os macos > ~/glassbox-tokens/token-A.txt)
(umask 077; docker exec glassbox glassbox-entrypoint machine add B --role work --os windows > ~/glassbox-tokens/token-B.txt)
```

Hand each token to its machine through a channel the user picks (see `docs/runbooks/install-probe.md`), then delete the files. Roles: `dev`, `work`, `deploy`, `gitea`. A lost token is replaced by running `machine add` again for that id.

**ACL.** The sidecar runs Tailscale in userspace mode. Without an ACL any tailnet member could also reach the hub's plain-HTTP port 8787 directly, bypassing `tailscale serve`. Tag the node (the sidecar advertises `tag:glassbox` by default; the auth key must be allowed to create it) and allow only port 443. In the Tailscale admin console, merge into the existing policy (do not replace it):

```json
{
  "tagOwners": { "tag:glassbox": ["autogroup:admin"] },
  "acls": [
    { "action": "accept", "src": ["<ALLOWED_USERS_OR_GROUP>"], "dst": ["tag:glassbox:443"] }
  ]
}
```

**Security note: the hub's pages `/` and `/page.json` have no authentication.** The only protection is that the hub listens inside the tailnet and the ACL lets only your own devices reach `tag:glassbox:443`. Anything that can reach that port sees the full private view (project names, repositories, machines). Keep `<ALLOWED_USERS_OR_GROUP>` to your own devices, never enable Tailscale Funnel, never share the node. (`/ingest` is separately protected by per-machine tokens.) Tagged nodes do not expire their key; that is expected here.

## 5. Verification checklist

Each item has an expected result. Do not call the deploy done until all hold.

1. **Reachable in the tailnet, both page routes.** From a device on the tailnet and allowed by the ACL:
   ```sh
   for p in / /page.json /healthz; do curl -s -o /dev/null -w "$p %{http_code}\n" https://<NODE>.<TAILNET_NAME>.ts.net$p; done
   # expect: 200 for all three
   ```
2. **Wrong Host is refused (421).**
   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: evil.example' https://<NODE>.<TAILNET_NAME>.ts.net/page.json   # expect: 421
   ```
   `tailscale serve` preserves the original Host header (read in the Tailscale source, v1.78.1; keep this runtime check anyway). If item 1 returns 421 instead of 200, `[serve] hosts` in `/opt/glassbox/hub.toml` is missing or differs from the Host the hub receives (typo, other `TS_HOSTNAME`, other tailnet name): fix it, then `docker restart glassbox`. To open the page by the node's tailnet IP, add that IP to `hosts` too.
3. **Nothing is published on the VM.**
   ```sh
   docker ps --format '{{.Names}} {{.Ports}}' | grep -E '^glassbox'     # expect: Ports column empty for all three
   ```
   The workflow checks `PortBindings` of the three containers on every deploy.
4. **Not on the LAN.** From a LAN device that is not on the tailnet (or with Tailscale off), against the VM's LAN address:
   ```sh
   curl -m 5 http://<VM_LAN_IP>:8787/healthz       # expect: connection refused or timeout
   curl -m 5 -k https://<VM_LAN_IP>/healthz        # expect: not the glassbox response
   ```
5. **Not on the internet; no Funnel.** `docker exec glassbox-tailscale tailscale funnel status` says funnel is off; `/opt/glassbox/serve.json` has no `AllowFunnel` (checked by the preflight too); `https://<NODE>.<TAILNET_NAME>.ts.net/healthz` times out from a device without Tailscale (a phone on mobile data).
6. **The sidecar advertises no routes and no exit node.** `docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' glassbox-tailscale | grep TS_EXTRA_ARGS` shows only `--advertise-tags=tag:glassbox` (the workflow fails if it contains routes or an exit node). Also confirm in the Tailscale admin console that the machine has no subnet routes or exit-node setting pending approval.
7. **Port 8787 closed to the tailnet.** From a second tailnet device: `curl -m 5 http://<NODE>.<TAILNET_NAME>.ts.net:8787/healthz` must fail. If it answers, the ACL (section 4, ACL part) is not in force.
8. **Secrets loaded** (names only, no values):
   ```sh
   docker exec glassbox glassbox-entrypoint check-secrets
   # expect: one "NAME: set" line per file in secrets/ (GITHUB_TOKEN, GITEA_MAIN_TOKEN, BESZEL_PASSWORD)
   ```
9. **Docker proxy lists only.**
   ```sh
   docker exec glassbox python -c "import urllib.request as u,urllib.error as e
for p in ('/containers/json?all=1','/containers/x/json','/containers/x/logs','/info'):
    try: print(p, u.urlopen('http://docker-proxy:2375'+p, timeout=5).status)
    except e.HTTPError as x: print(p, x.code)"
   # expect: 200, then 403, 403, 403 (a 404 for /containers/x/json means the proxy let it through: fix the allowlist)
   ```
   If `docker-proxy` does not start with `read_only` and `cap_drop`, drop `read_only` first, then `cap_drop`, and note which one was needed.
10. **Ingest needs a token.** `curl -s -X POST https://<NODE>.<TAILNET_NAME>.ts.net/ingest -d '{}'` returns HTTP 401 `{"error": "bad token"}`.
11. **A collector run works.** `docker exec glassbox glassbox-entrypoint collect all` prints lines for github, gitea and `monitors:` without `error`. (A plain `docker exec glassbox python -m hub ...` would not have the secrets: always go through `glassbox-entrypoint`.) Confirm the Gitea instance lists its organisation repositories (the collector asks `/user/repos`); see `docs/runbooks/deploy-hub.md`.

## Rollback

Actions, glassbox, Run workflow, branch `main`, **tag** = the 40-hex commit SHA of an image that was pushed before. The build is skipped and that image is pulled and started (the tag input goes through an environment variable and must match `[0-9a-f]{40}`). Database migrations do not roll back with the image: after a `SCHEMA_VERSION` change an older image refuses the newer database, so restore the volume from backup in that case.

## Local build instead of the registry

From the repository root, with a directory laid out like `/opt/glassbox`:

```sh
GLASSBOX_IMAGE=glassbox-hub IMAGE_TAG=local DOCKER_GID=$(stat -c %g /var/run/docker.sock) \
GLASSBOX_DIR=<DIR_LIKE_OPT_GLASSBOX> \
docker compose -f deploy/compose.yaml -f deploy/compose.build.yaml up -d --build
```

## Restarting

If the `tailscale` container is restarted or recreated by hand, restart the hub as well (`docker restart glassbox`): it is attached to the sidecar's network namespace, which is replaced. `depends_on ... restart: true` normally does this already (needs Compose 2.17 or newer).
