# Deploy the hub

Machines: the deploy VM (V) on the deploy host (C). The hub is deployed by the Gitea Actions workflow `.gitea/workflows/glassbox.yml` (build, push, `docker compose up -d` on the VM's own Docker). The procedure, file layout, permissions and the verification checklist are in [`deploy/README.md`](../../deploy/README.md); this page is the order of work and who does what.

**ASK THE USER FIRST** before touching the deploy host, the VM, Gitea settings or the tailnet policy. Adding a published VM port is not part of this design (the Tailscale sidecar needs none); if a step seems to need one, stop and ask.

**Secrets rule:** the user types every token and key themselves (echo off, on the VM), and runs `machine add` themselves with the output redirected to a private file. An agent does not read, receive or echo a secret value; a value printed in an agent's terminal ends up in its transcript. Agents only check names, owners, modes and `set` / `not set`.

## 1. Clone and install the privacy hook

Clone the repository where you edit it and follow [install-probe.md](install-probe.md) step 1 (the hook is per clone).

**Verify**: run `.git/hooks/pre-commit; echo $?` in the clone. Expect exit code 0, or 2 with a "setup error" message if the private term list has not been handed over yet (hand-over is the user's step).

## 2. Prepare `/opt/glassbox` on the VM (the user)

`deploy/README.md` section 1: directory, `hub.toml` (with `[serve] hosts`), `serve.json`, `ts_authkey`, `secrets/*`, owner `root:10001`, mode `0640` (the hub's uid 10001 must be able to read them; `ts_authkey` is `root:root` `0600`).

**Verify** (no values shown): `sudo ls -ln /opt/glassbox /opt/glassbox/secrets` shows the owners and modes from the table; `sudo -u '#10001' -g '#10001' test -r /opt/glassbox/secrets/github_token && echo readable-by-10001`; `sudo grep -c AllowFunnel /opt/glassbox/serve.json` prints `0`.

## 3. Gitea repository variables and secret (the user)

`REGISTRY`, `IMAGE` (variables) and `REGISTRY_TOKEN` (secret): `deploy/README.md` section 2.

**Verify**: the Gitea Settings page lists the three names. Do not ask the user to read the token aloud.

## 4. Tailnet ACL and tag (the user, in the Tailscale console)

`deploy/README.md` section 4: `tag:glassbox`, allow only `<ALLOWED_USERS_OR_GROUP>` to reach `tag:glassbox:443`. The auth key in `ts_authkey` must be created with that tag.

## 5. First deploy

Push to `main` or run the workflow by hand. The **预检** step stops the run with a list of missing files if section 2 is incomplete; nothing is deployed then.

**Verify**: the run is green; `docker ps --filter label=com.docker.compose.project=glassbox --format '{{.Names}} {{.Status}}'` shows three containers, `glassbox` healthy; `docker logs glassbox` contains `glassbox hub listening`. The database starts empty (a development database is refused by the `schema_version` check).

## 6. Verification checklist

Run every item in `deploy/README.md` section 5: tailnet 200 on `/` and `/page.json` by the MagicDNS name (that name is in `[serve] hosts` of the VM's `hub.toml` only, never in git); wrong Host gives 421; `docker ps` shows no published ports; a request to the VM's LAN address is refused; `tailscale funnel status` is off and `serve.json` has no `AllowFunnel`; the sidecar advertises no routes or exit node; port 8787 is closed to the tailnet; `check-secrets` lists one `NAME: set` per secret; the Docker proxy allows only the listing.

## 7. Collectors and the Gitea organisation check

```sh
docker exec glassbox glassbox-entrypoint collect all
```
**Verify**: no `error` entries in the `monitors:` line; `github:` and `gitea:` print counts.

Organisation repositories (S13 follow-up 3): for each Gitea instance, pick one organisation repository you contribute to and check that `GET /api/v1/user/repos?limit=50` lists it. The user runs this check (it needs the token): `printf 'Authorization: token %s\n' "$(sudo cat /opt/glassbox/secrets/gitea_main_token)" | curl -sS -H @- "<GITEA_URL>/api/v1/user/repos?limit=50"` (the token goes through stdin, not the command line). If it is missing on either instance, report to the lead: the collector in `hub/sources.py` needs a `/orgs/{org}/repos` listing added. Do not patch it on the VM.

## 8. Register machines and hand out tokens (the user)

`deploy/README.md` section 4: `docker exec glassbox glassbox-entrypoint machine add ... > <private file>` under `umask 077`. The user hands each token to the matching machine's agent through a channel they choose (direct paste at a silent prompt; not a file in the repository, not a logged message), then deletes the files.

## 9. Rollback and backups

Rollback: run the workflow by hand with the 40-hex SHA of an earlier image (`deploy/README.md`, Rollback). Backups: add the volume `glassbox_glassbox-data` to the VM's backup job (**ASK THE USER FIRST**; the job is theirs).
