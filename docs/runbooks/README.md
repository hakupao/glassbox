# Runbooks for per-machine agents

Audience: an agent (or a person) on one machine that has cloned this repository. Machines are only ever named by code: **A** dev, **B** work, **C** deploy host, **V** deploy VM, **D** Gitea machine. The user tells you which code your machine has.

Rules for every runbook:

- Each step has a **Verify** line with a command and the expected result. Do not continue when it does not match.
- Steps marked **ASK THE USER FIRST** change something outside the repository on this or another machine (installing software, joining a network, creating tokens, opening a service). Wait for an explicit yes.
- Secrets (hub token, auth keys, API tokens, `account_salt`) are handed over separately by the user. Never write them into the repository, a commit, an issue, or a chat message.
- Never copy a real hostname, address, domain, user name or path into a file that git tracks.

| Runbook | Machines | Purpose |
|---|---|---|
| [install-tailscale.md](install-tailscale.md) | A, B, D (and C/V if the user asks) | Join the tailnet |
| [install-probe.md](install-probe.md) | A, B | Probe, schedule, privacy hook |
| [install-beszel-agent.md](install-beszel-agent.md) | A, B, D | System status agent |
| [deploy-hub.md](deploy-hub.md) | C/V | Run the hub (points to `deploy/README.md`) |

## Follow-ups S13 and where each is handled

| # | Follow-up (from `_progress.json`, S13) | Handled in |
|---|---|---|
| 1 | Install the pre-commit privacy hook on every clone (`.git/hooks` is not versioned) | install-probe.md step 1 (also do it on every other clone, including the deploy machine's) |
| 2 | Gitea read-only tokens for both instances; GitHub fine-grained read-only token | deploy/README.md section 1 (what to create); deploy-hub.md step 2 (who hands them over) |
| 3 | Verify Gitea `/user/repos` includes organisation repositories on both instances, else add `/orgs/{org}/repos` | deploy-hub.md step 5 (check procedure; code change needed only if the check fails) |
| 4 | Start the deploy hub from a fresh database | deploy/README.md section 2; deploy-hub.md step 3 |
| 5 | Beszel agents on A, B, D | install-beszel-agent.md |
| 6 | Tailscale on A (the probe pushes over the tailnet) | install-tailscale.md |
| 7 | docker-socket-proxy for container run state | `deploy/compose.yaml` service `docker-proxy`; hub `[docker]` section in `deploy/hub.example.toml` |
| 8 | Runbook for an agent on each machine, per-machine secrets handed over separately | this directory; secret handover rules above and in install-probe.md step 3 |
| 9 | Decide Beszel agent <-> hub direction for the off-LAN work machine | install-beszel-agent.md section "Open decision" (left pending for S13) |
