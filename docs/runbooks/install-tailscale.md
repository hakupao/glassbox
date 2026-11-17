# Install Tailscale

Goal: this machine joins the tailnet, so the probe can reach the hub at `https://glassbox.<TAILNET_NAME>.ts.net` without any LAN or public exposure.

Everything here is an external change. **ASK THE USER FIRST** before step 1, and again before step 2 (it needs their account login).

## 1. Install (ASK THE USER FIRST)

- macOS: install the Tailscale app from the Mac App Store or the standalone package from tailscale.com, or `brew install --cask tailscale`. Open it once so the menu-bar client starts.
- Windows: install from tailscale.com (installer) or `winget install Tailscale.Tailscale`. Run it as a normal user afterwards.

**Verify**
```sh
tailscale version
```
Expect a version number. On macOS, if the `tailscale` command is missing, use `/Applications/Tailscale.app/Contents/MacOS/Tailscale` in its place. On Windows, `tailscale.exe` is in `C:\Program Files\Tailscale\`.

## 2. Join the tailnet (ASK THE USER FIRST)

The user signs in to their own Tailscale account in the browser window the client opens. Do not use someone else's auth key; do not store any key on this machine.

```sh
tailscale up
```

**Verify**
```sh
tailscale status
```
Expect: this machine listed as connected, and the machine running the hub (`glassbox`) appearing in the peer list. A line starting with "Logged out" or "Stopped" means step 2 did not complete.

## 3. Check the hub is reachable

```sh
curl -fsS https://glassbox.<TAILNET_NAME>.ts.net/healthz
```
Expect `{"ok": true}`. Failure causes in order: hub not deployed yet (see `deploy-hub.md`), the tailnet ACL does not allow this machine to reach the hub, MagicDNS or HTTPS certificates not enabled for the tailnet (user toggles these in the admin console, **ASK THE USER FIRST**).

## 4. Keep it on

Tailscale must start at login and stay connected: macOS "Launch at login" in the Tailscale menu; Windows runs as a service by default.

**Verify** after a reboot: `tailscale status` shows connected without manual action.
