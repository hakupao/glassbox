# Install the Beszel agent

Machines: A, B, D. The Beszel hub already runs on the deploy host and lists only the deploy host and its VM today. The glassbox hub reads it through a read-only account (`[beszel]` in `hub.toml`), and keeps only systems named in `[beszel.map]`.

Check the exact commands and options against the current Beszel documentation before running: the agent options and the connection modes have changed between releases. Everything here is an external change: **ASK THE USER FIRST**.

## Open decision (S13, not decided yet): connection direction

By default the Beszel hub connects **to** each agent (SSH-based, agent listens on a TCP port). That works for machines on the same LAN as the Beszel hub (A, D). Machine B is off the LAN, so the hub cannot reach it directly. Options, pick one with the user before installing on B:

| Option | Idea | Cost |
|---|---|---|
| 1. Hub to agent over the tailnet | Beszel hub (or the host/VM it runs on) is on the tailnet and adds B by its tailnet address | The Beszel hub's network must be able to use the tailnet: Tailscale on the VM host, or a subnet router. Touches the deploy host. |
| 2. Agent to hub (WebSocket mode, newer Beszel) | The agent dials the hub using a hub URL and a token; no inbound port on B | The hub URL must be reachable from B: expose the Beszel hub into the tailnet (for example a second `tailscale serve` target). Touches the deploy host. |
| 3. Skip B in Beszel | B reports only through the probe; no CPU/memory graphs for B | No infrastructure change; B appears without system stats. |

Until the user decides: install on A and D with the default direction, and do **not** install on B.

## 1. Add the system in the Beszel hub (ASK THE USER FIRST)

In the Beszel hub UI (admin account, which is the user's), choose "Add system", enter a name, and copy the generated public key (and token if the version shows one). The name must equal the left-hand side of the matching `[beszel.map]` entry in the glassbox `hub.toml`; the right-hand side is this machine's code.

## 2. Install the agent

Follow the "Add system" dialog of the user's Beszel version, which shows the exact command for this OS. Typical forms:

- macOS / Linux: the one-line install script or a binary run as a launchd/systemd service; or a container (`henrygd/beszel-agent`) on Linux.
- Windows: the installer script for Windows or the binary run as a service.

Keep the agent's port reachable only from the Beszel hub (host firewall or LAN scope); do not forward it on a router.

**Verify**
- Agent side: the service is running (`launchctl list | grep -i beszel` on macOS; `Get-Service *beszel*` on Windows) and listens on its port (macOS: `lsof -iTCP -sTCP:LISTEN -P | grep -i beszel`; Windows: `Get-Process *beszel* | ForEach-Object { Get-NetTCPConnection -State Listen -OwningProcess $_.Id }`).
- Hub side: the system turns "up" in the Beszel UI within a minute and shows CPU, memory and disk.

## 3. Map it for glassbox

On the deploy host's `deploy/hub.toml`, make sure `[beszel.map]` contains `"<BESZEL_SYSTEM_NAME>" = "<MACHINE_CODE>"` (the systems for A, B, D, C, V). Then restart the hub or wait for the next collect.

**Verify**
```sh
docker compose exec glassbox glassbox-entrypoint collect monitors
```
Expect `beszel` in the output to report a systems count including this machine, with no `error`.
