# Install the probe and its schedule

Machines: A (macOS) and B (Windows). The probe reads local Claude Code / Codex logs and git history, builds an aggregate report (numbers and opaque project ids, no prompts or code), and POSTs it to the hub over the tailnet.

Prerequisites: [install-tailscale.md](install-tailscale.md) done and the hub deployed ([deploy-hub.md](deploy-hub.md)). Python 3.12 (standard library only; no `pip install`).

Which projects and repositories this machine reports is the user's call, project by project (private repositories included or not). **ASK THE USER FIRST** which directories go into `git_roots` and which agent log roots to read.

## 1. Clone and install the pre-commit privacy hook

`.git/hooks` is not versioned, so every clone needs this once. Without it a commit can leak private names.

```sh
git clone <REPO_URL> <CLONE_PATH>
cd <CLONE_PATH>
```

macOS (create `.git/hooks/pre-commit`, then make it executable):

```sh
cat > .git/hooks/pre-commit <<'EOF'
#!/bin/sh
# glassbox: refuse to commit when the privacy scan finds anything (scripts/privacy_scan.py).
exec python3 "$(git rev-parse --show-toplevel)/scripts/privacy_scan.py" >&2
EOF
chmod +x .git/hooks/pre-commit
```

Windows (Git Bash; the hook runs under Git for Windows' shell): same content, with `python` instead of `python3` if `python3` is not on the PATH.

The scan needs the private term list `.local/redact_terms.local.json` (git-ignored). The user hands it over separately; place it at that path inside the clone. If it is missing the hook fails closed (exit 2, "setup error") and blocks every commit, which is the intended behaviour.

**Verify**
```sh
python3 scripts/privacy_scan.py; echo "exit=$?"
```
Expect `exit=0` and no findings. Then `git commit --allow-empty -m "hook check"` runs the hook and succeeds; remove that commit with `git reset --soft HEAD~1`. Repeat on every other clone of this repository on the machine.

## 2. Probe configuration (outside the repository)

Create `~/.glassbox/probe.toml` (Windows: `%USERPROFILE%\.glassbox\probe.toml`). This file is never committed.

```toml
machine = "<MACHINE_CODE>"                  # A or B, as the user assigned
tz = "Asia/Tokyo"
account_salt = "<ACCOUNT_SALT>"             # MUST be identical on every machine
git_roots = ["<PROJECTS_DIR>"]              # directories whose subfolders are repositories
author_emails = ["<AUTHOR_EMAIL>"]
hub_url = "https://glassbox.<TAILNET_NAME>.ts.net"
hub_token_file = "~/.glassbox/hub.token"
# claude_roots / codex_roots default to ~/.claude/projects and ~/.codex/sessions
```

`account_salt` is a random string chosen once by the user and handed over separately. If two machines use different salts, the same project gets different ids on the hub and usage is split. Check by comparing the salt with the user, not by looking it up in the repository (it is not there).

**Verify**
```sh
python3 -m probe --config ~/.glassbox/probe.toml scan
```
Expect a line like `scanned N files, read M (... GB), ... rows upserted, ... unique requests`. The first scan can take a while; later ones take seconds.

## 3. Hub token handover

The hub prints one token per machine when the user (or the deploy agent) registers it: `deploy/README.md` section 3. The user gives it to you directly, outside the repository and outside any logged channel.

The token must not appear on a command line (it would land in shell history and process listings). Type or paste it at a silent prompt.

macOS:
```sh
umask 077; mkdir -p ~/.glassbox
printf 'Hub token: '; stty -echo; read -r T; stty echo; echo
printf '%s' "$T" > ~/.glassbox/hub.token; unset T
chmod 600 ~/.glassbox/hub.token
```
Windows (PowerShell):
```powershell
New-Item -ItemType Directory -Force "$HOME\.glassbox" | Out-Null
$s = Read-Host 'Hub token' -AsSecureString
$t = [System.Net.NetworkCredential]::new('', $s).Password
Set-Content -NoNewline -Path "$HOME\.glassbox\hub.token" -Value $t
Remove-Variable t, s
icacls "$HOME\.glassbox\hub.token" /inheritance:r /grant:r "$($env:USERNAME):(R,W)"
```

**Verify**
```sh
python3 -m probe --config ~/.glassbox/probe.toml push
```
Expect `pushed: {"ok": true, ...}`. `hub refused (401)` = wrong token or machine id mismatch; `hub refused (400)` mentions the cause (for example a machine code that differs from the one the token is bound to); `hub unreachable` = tailnet problem, go back to install-tailscale.md step 3.

Optional, macOS only: the Claude Code quota samples come from `scripts/statusline-tap.sh` wrapped around the statusline command and configured via `claude_quota_samples`. That edits `~/.claude/settings.json`: **ASK THE USER FIRST**, back the file up, and describe the rollback.

## 4. Schedule: every 15 minutes

### macOS (launchd)

**ASK THE USER FIRST** (creates a login item). Create `~/Library/LaunchAgents/glassbox.probe.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>glassbox.probe</string>
  <key>ProgramArguments</key><array>
    <string><PYTHON3_ABSOLUTE_PATH></string><string>-m</string><string>probe</string>
    <string>--config</string><string><HOME_DIR>/.glassbox/probe.toml</string><string>push</string>
  </array>
  <key>WorkingDirectory</key><string><CLONE_PATH></string>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string><HOME_DIR>/.glassbox/probe.log</string>
  <key>StandardErrorPath</key><string><HOME_DIR>/.glassbox/probe.log</string>
</dict></plist>
```
launchd does not expand `~`, so write absolute paths in this file (it lives outside the repository). Then:

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/glassbox.probe.plist
```
**Verify**
```sh
launchctl print gui/$(id -u)/glassbox.probe | grep -E 'state|last exit'
tail -n 3 ~/.glassbox/probe.log
```
Expect `last exit code = 0` and a `pushed:` line in the log within a minute (`RunAtLoad`). Remove: `launchctl bootout gui/$(id -u)/glassbox.probe`.

### Windows (Task Scheduler)

**ASK THE USER FIRST**. In PowerShell, as the normal user (no admin needed):

```powershell
$py  = "<PYTHON312_ABSOLUTE_PATH>"
$cfg = "$HOME\.glassbox\probe.toml"
$act = New-ScheduledTaskAction -Execute $py -Argument "-m probe --config `"$cfg`" push" -WorkingDirectory "<CLONE_PATH>"
$trg = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)
$set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName "glassbox-probe" -Action $act -Trigger $trg -Settings $set
```
**Verify**
```powershell
Start-ScheduledTask -TaskName "glassbox-probe"; Start-Sleep 30
Get-ScheduledTaskInfo -TaskName "glassbox-probe" | Select-Object LastRunTime, LastTaskResult
```
Expect `LastTaskResult` 0. To see the output, run the push command by hand once (step 3). Remove: `Unregister-ScheduledTask -TaskName glassbox-probe -Confirm:$false`.

## 5. End check

On the hub side the machine's `last_report` moves forward every 15 minutes. From the deploy VM:
```sh
docker compose exec glassbox python -c "import sqlite3,time;c=sqlite3.connect('/data/hub.sqlite');print([(m,None if t is None else round(time.time()-t)) for m,t in c.execute('select id,last_report from machines')])"
```
Expect each registered machine with an age below about 1000 seconds. `None` means that machine has never reported (go back to step 3 for it).

If a machine's history legitimately shrinks (for example logs were cleaned), the hub refuses the report; the user decides, then runs `python -m hub --config ... machine rebaseline <ID>` on the hub and pushes with `--rebaseline`.
