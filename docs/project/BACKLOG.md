# Backlog

Open items after S15 (2026-11-18). To be handled together; each one gets its own review before it ships.

## A. Data shown wrong

| # | Item | Where | Notes |
|---|---|---|---|
| A8 | Two more ways the gate can refuse the whole page with nothing leaking (found in the A6 review; they predate A6): (1) a title with a literal backslash sequence such as `\r\n` serialises to `\\r\\n`, which the gate's path / UNC pattern matches in the raw layer; (2) the exporter's join check covers names only, not the gate's patterns, so values joined or decoded into e.g. `//` (protocol-relative) are refused | hub/export.py `scrub_title`, `_hits` | Exporter: check the serialised title against its own copy of the gate's path / URL patterns and degrade that commit; extend the join check to patterns |

## B. UI

| # | Item | Notes |
|---|---|---|
| B6 | Background art, follow-ups after the rewrite (B1) | (1) First frame after mount or a time jump costs 40–60 ms on pieces 01, 06, 07, 16 (one frame); several pieces' first `make()` is over 30 ms (dunes, river, snowfall, night pass). (2) Frame cost is at or just over the 2 ms aim at 1440 px on pieces 10, 11, 12, 16. (3) Goldfish: on one date a phone shows 3.8% lit pixels behind the caption (limit 3%). (4) The kit's `Layer` keeps one grid-sized array per colour and level; a shared index with a counting sort (as the newer pieces do) would cut memory on large screens. (5) Not checked: Safari, Firefox, real low-end devices. (6) Whale (12) draws no whales below about 64 rows on the desktop branch (667x375 and 844x390 landscape phones: sea and glints only, caption still says whale); could lower the threshold now that the loop is bounded. (7) When the size guard leaves the canvas empty (under 48 rows or 60 columns), the caption and aria text still describe the piece. (8) Under sustained slow draws the clock and countdowns, which tick with the art, can lag up to 0.5 s. (9) `INK` in `web/art.js` is dead code. (10) Phone breakpoint: CSS uses the viewport (`max-width:640px`), JS the canvas width (`< 640`); edge widths can disagree. (11) `create()` has no `destroy()` (single instance today). (12) The bundled page grew from 362 KB to 940 KB (gzip 104 to 317 KB) and the gate run on it from 4.7 to 8.5 s; watch it on the VM. |

## C. Operations

| # | Item | Notes |
|---|---|---|
| C4 | Token expiry reminders: GitHub read-only token, Gitea read-only token, publish token | Calendar entries before they expire |
| C5 | After a reboot, confirm Tailscale reconnects by itself on the Windows machine and on the dev Mac | `tailscale status` |
| C6 | Windows probe: confirm which agent log roots should be reported (defaults `~/.claude/projects`, `~/.codex/sessions`) | |
| C8 | The home-lab services README still describes the backup scope without glassbox | Separate repository |

## D. Optional

| # | Item | Notes |
|---|---|---|
| D1 | GitHub social preview image | Settings, General, Social preview: `docs/screenshots/overview.png` |

## E. Project

| # | Item | Notes |
|---|---|---|

## Done

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
