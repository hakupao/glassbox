# Deploy the hub

Machines: the deploy VM (V) on the deploy host (C). The full procedure, files and verification are in [`deploy/README.md`](../../deploy/README.md); this page adds the order of work and the things that need the user.

**ASK THE USER FIRST** before touching the deploy host or VM at all. Adding a published VM port is not part of this design (the Tailscale sidecar needs none); if a step seems to need one, stop and ask.

## 1. Clone and install the privacy hook

Clone the repository on the VM and follow [install-probe.md](install-probe.md) step 1 (the hook is per clone).

**Verify**: run `.git/hooks/pre-commit; echo $?` in the clone. Expect exit code 0, or 2 with a "setup error" message if the private term list has not been handed over yet (hand-over is the user's step).

## 2. Secrets (the user hands these over)

The user supplies, separately from the repository: a Tailscale auth key, a GitHub fine-grained read-only token, one read-only token per Gitea instance, a read-only Beszel account password. Create the files exactly as in `deploy/README.md` section 1 and `chmod 600`.

**Verify**: `ls -l deploy/secrets` shows mode `-rw-------` for each file; `git status --short` shows none of them.

## 3. Start from a fresh database

`cd deploy && docker compose up -d --build`, then check as in `deploy/README.md` section 2.

**Verify**: `docker compose ps` shows three services running and `glassbox` healthy; `docker compose logs glassbox` contains `glassbox hub listening`.

## 4. Verify exposure

Run all four checks in `deploy/README.md` section 4 (tailnet reachable; no published ports; not on the LAN; not on the internet; ingest refused without a token).

## 5. Collectors and the Gitea organisation check

```sh
docker compose exec glassbox python -m hub --config /etc/glassbox/hub.toml collect all
```
**Verify**: no `error` entries in the `monitors:` line; `github:` and `gitea:` print counts.

Organisation repositories (S13 follow-up 3): for each Gitea instance, pick one organisation repository you contribute to and compare:
1. `curl -H "Authorization: token <TOKEN>" "<GITEA_URL>/api/v1/user/repos?limit=50"` lists it, or
2. it is missing.
If it is missing on either instance, report that to the lead: the collector in `hub/sources.py` needs a `/orgs/{org}/repos` listing added. Do not patch it on the deploy machine.

## 6. Register machines and hand out tokens

`deploy/README.md` section 3. Give each token to the matching machine's agent through a channel the user chooses (direct paste to that terminal; not a file in the repository, not a message that is logged).

## 7. Backups

Add the `glassbox-data` volume to the host's existing backup job (**ASK THE USER FIRST**; the job is theirs).
