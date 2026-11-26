# Backlog

Open items after S15 (2026-11-18). To be handled together; each one gets its own review before it ships.

## A. Data shown wrong

| # | Item | Where | Notes |
|---|---|---|---|

## B. UI

| # | Item | Notes |
|---|---|---|
| B6 | Background art, what is left after the 2026-11-23 pass | (1) First mount still 40–50 ms on dunes (05), river (06), night pass (07), snowfall (15), moon (19) and about 37 ms on swell (16): the cost is first-run per-cell work; going lower needs algorithm or precision changes that alter pixels. (2) Frame cost about 2.2 ms at 1440 px on 10 and 12. (3) Snowfall (15) sometimes draws a different mount frame than after the first relayout (3840 dpr1, once 1440 dpr1), and swell (16) on a busy machine: both reproduce old against old. (4) Optional hardening: the shared Layer index assumes every colour index is inside the palette (`key < NK` guard). (5) Not checked: Safari, Firefox, real low-end devices. |

## C. Operations

| # | Item | Notes |
|---|---|---|
| C12 | Full web/ word check with no exemption | A9 lets `check_web_terms.py` exempt words already in web/ at HEAD. A word that reached HEAD without the hook (`--no-verify`, rebase, cherry-pick, a clone without the hook) is exempt from then on. Add an on-demand run with `--head-repo` pointing at an empty repository (no exemption) and put it in the runbook or CI. |

## D. Optional

| # | Item | Notes |
|---|---|---|

## E. Project

| # | Item | Notes |
|---|---|---|

## Done

- A9 (2026-11-26): a private branch part that is a word of the page's own code (web/index.html and the .js / .css it inlines, split like the gate splits words, e.g. "route" of `data-route`) is no private name, in the exporter and the gate alike (each keeps its own copy, a test checks both give the same set). A part that is a component of a private name, term, keyword or private project stays private, so such a branch still stops publishing (fail closed). The pre-commit word check (`check_web_terms.py`) exempts only the words of web/ as committed at HEAD, so a word first added to web/ cannot free itself. Fixes two publisher stalls on 2026-11-26 while a local commit's branch waited for its Gitea copy; nothing was published.
- C5, C6 (2026-11-24, on the Windows machine): C5: the Tailscale service starts automatically (not delayed), the client starts at login, and unattended mode is now on (`tailscale set --unattended=true`), so the tailnet stays up without a signed-in user; runbook step 4 now says so. Not yet verified: a push after a reboot and before anyone logs in (check the machine's last report on the hub after the next reboot); the dev Mac's reboot check is still open too. C6: the probe keeps the default roots `~/.claude/projects` and `~/.codex/sessions`, no config change. Checked and left out: no WSL distribution, no other user profile with agent logs, `~/.claude/transcripts` (another tool's format, stopped in February), and directories that hold no session logs (jobs, history, session index, plugin cache, per-project `.claude`). Also seen: one scheduled push took over 2 minutes, of which the log scan was 12 s; the rest is not measured yet.
- B6 part (2026-11-23): the art kit's Layer uses one shared index with a counting sort (heap at 2560 px: 83 MB to 10 MB, pixels identical); swell (16) mount about 13 ms faster; goldfish (11) on phones keeps light shafts and fish below the caption band, so no day of the year passes 3 % lit pixels behind the caption (was up to 9 %). The rest stays in B6.
- A8 (2026-11-23): the exporter has its own copy of the gate's patterns (paths, URLs, protocol-relative, secrets) and checks each commit's title and branch as the gate reads them (indented and compact JSON, joined values raw and decoded); a hit degrades that commit only. Random pages refused by the old exporter: about 100 in 300; now 0.
- C4, C8, D1 (2026-11-23): C4 checked: the two GitHub fine-grained tokens are set to never expire and the Gitea tokens have no expiry, so no reminders are needed (add one if a token is regenerated with an expiry). C8: the home-lab services README has a glassbox section (deployment, alerts, backup and restore). D1: the GitHub social preview is a 1280x640 shot of the public overview.
- A6 (2026-11-23): the exporter checks titles and public branches across all of the gate's decoding layers; a public branch that joins into a private name is nulled (`degraded.branchesJoined`); a title prefix that still joins becomes `******`. A join costs a constant number of page scans. Follow-up: A8.
- B5, B7, C10, C11 (2026-11-23): B5 machine metric labels never wrap (values ellipsize, full value in the tooltip). B7 `scripts/screenshots.sh` takes the README screenshots from the frozen frame `?t=8`. C10 `python -m probe push --every 900` under launchd KeepAlive replaces StartInterval in the macOS runbook. C11 `sync_publish.sh --apply` first asks the running publisher (`--check-config`) and refuses unless it answers ok, so config can no longer run ahead of the deployed code.
- E2, E3, E4 (2026-11-23): adopted as working rules for later steps: visual work gets one approved sample before the batch; the private trace is appended by a script with clock timestamps; large steps land as several commits and drafts do not stay untracked.
- B2 (2026-11-19, S17 R08, 8963aac): machine mini charts replay the 24 h history as a sliding window, only when visible and without reduced motion, marked "replay".
- B4 (2026-11-19..21, S17 R06 37cde2b, R09): activity view is a day-grouped timeline with filter chips, nested commit cards and a phone tab bar; author and file lists in R09 (B4c).
- A7 (2026-11-23): `scripts/check_web_terms.py` runs the gate's own matcher with the real word list, config and a cached private page over the shipped web/ code (each inlined file and the whole bundled page), printing only file:line and term ordinals; the local pre-commit hook runs it (and `check_web.py`) on the staged web/ (`docs/runbooks/install-probe.md`, step 1). Not caught: a word formed with real page data next to the code.
- C9 (2026-11-23): stale-probe alert: each publisher cycle pushes up/down with counts only to the Kuma push monitor "glassbox probes" (`kuma_probes`); down when a machine is online per Beszel but its probe is older than `probeStale` (1800 s). Machines without a Beszel agent cannot be checked this way. First push 12:04, `probes ok (2)`.
- C1 (2026-11-23): publisher failure alert: Uptime Kuma push monitor "glassbox publisher" (heartbeat 900 s, 1 retry, phone notification) fed by the publisher through `kuma_push`; first heartbeat received 10:29.
- E1 (2026-11-23): S16 project retrospective written (kept practices, gaps, key decisions; private because it cites real data). Its gaps are filed as A7, B7, C9-C11, E2-E4.
- B1 (2026-11-23, S17 R14): the daily background art is rewritten: 19 pieces modelled on real subjects and footage (measured from reference photographs, real motion, natural colour), replacing the first library; seven abstract templates became natural subjects (Saturn, aurora, meadow, dunes, braided river, the Earth at night from orbit, the galaxy M81). Captions were re-audited against the code: each claims only what is drawn, and the Claude Code / Codex split line shows only under the six pieces that draw it in the interface colours. Very small canvases show no art; very large ones use a coarser grid. Follow-ups: B6, A7.
- A5 (2026-11-21): a public commit title that spells a private name only when joined to the next JSON key, or only in the HTML bundle's escaped form, is now cut to its prefix for that one commit instead of the gate refusing the whole page. The export context counts it (`titlesJoined`).
- A4, B4c (2026-11-21, S17 R09): commits show the author and a file list with M/A/R/D badges. File paths come only from GitHub (hub, single-commit endpoint) and appear in the public snapshot only on public, pushed, GitHub-source commits; private commits show a file count. Branch parts listed in `branchFragments` (public.toml) may be public; a listed part that is also part of a private name stays private.
- B3, C2, C3 (2026-11-19): B3: zh `rt.fresh` is now "最新", as in ja. C2: `scripts/sync_publish.sh` compares (dry run, default) or copies (`--apply`) the two publisher config files to the VM; see `deploy/README.md`. C3: the page warns (`machine-config`, a count only) when Beszel returns systems that `[beszel.map]` does not list; checklist in `docs/runbooks/install-beszel-agent.md`.
- C7 (2026-11-18): Windows task runs `pythonw.exe`; no console window (no conhost child), `LastTaskResult` 0, `probe.log` shows `(no console)` and `pushed: {"ok": true ...}`.
- A1, A2 (2026-11-19): not data bugs. The README screenshots `machines.png` and `overview.png` were taken while the KPI numbers were still rolling up (0.9 s); the live page settles on the same value as the panel title and the per-agent line ("205 req/session" in the same shot is 818 / 4). Fix: retake the screenshots after the roll.
- A3 (2026-11-19): a machine whose label equals its own public code is exempt from the private-name list (exporter and gate, judged per machine; a non-code id stays private); the code clash check compares normalised names on both sides.
- Publisher stop (2026-11-19, 12:10 to deploy): the owner's profile repo (public, no separators) also appeared as a part of a private branch, so the gate saw one name as both public and private. A branch part that spells a public repo name, in any case, is no longer a private name (exporter and gate).
