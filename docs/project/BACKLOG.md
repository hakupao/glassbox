# Backlog

Open items after S15 (2026-11-18). To be handled together; each one gets its own review before it ships.

## A. Data shown wrong

| # | Item | Where | Notes |
|---|---|---|---|
| A4 | A private branch that contains a word of a hyphenated public repo name (`IT-Passport-Learning/...` gives `Passport`, `Learning`) still makes the gate reject the page, so publishing stops | scripts/verify_public.py derive(), hub/export.py | Owner to decide: also compare branch parts with the words of public repo names. Cost: a private word that happens to equal such a word would pass |

## B. UI

| # | Item | Notes |
|---|---|---|
| B1 | Background art: refine | Several versions to choose from |
| B2 | Machine mini charts: replay the 24 h history as a sliding window (one step per second, looping), like the reference site's public snapshot | Only when visible and without `prefers-reduced-motion`; show a small "replay" mark so it is not mistaken for live data |
| B4 | Activity view: learn from the reference site's activity feed (`#cat=activity&tab=feed`) | Ours is a flat commit list with a detail popup (`web/pages.js` `commitItem`). Reference: a vertical timeline grouped by day ("today, 6 changes"); each commit is a nested card (repo tag, short hash, "unpushed" badge, author, time, file list with M/A/R badges, "load more (17)", diff link); filter chips with counts (all / commits / pushed / unpushed ...); on phones a bottom tab bar, cards keep the timeline rail, long paths cut with an ellipsis; smooth expand and switch animations. Public snapshot rule still applies: private repo names and file paths must not leak, so the file list may be public-repo only or counts only. Take the design rules, not the components; first set them as variables and conventions in `web/styles.css`, then change the pages: (1) clear order inside a card (tags, title, author and time, files, actions), only 3 to 4 levels of size and color; (2) color only where things must be told apart (repo tag, file status, timeline dot), the rest in grays, badges small with pale fills; (3) monospace for data only (hashes, paths, times), body font for text; (4) a fixed spacing scale between and inside cards; (5) phone layout designed on its own: bottom tab bar, full-width segmented switch, paths cut with an ellipsis instead of wrapping; (6) long lists always folded ("load more (n)") so card height stays bounded |
| B5 | Machine panel (zh): the "内存" label wraps onto two lines on some rows at 1440 px | Overview machines panel | Seen 2026-11-19, already on the live site before R08 |

## C. Operations

| # | Item | Notes |
|---|---|---|
| C1 | Publisher failure alert | Create an Uptime Kuma push monitor, put its URL in `/opt/glassbox/publish/kuma_push` (the code already reports to it) |
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
| E1 | S16: project retrospective, `RETROSPECTIVE.md` (kept, gaps, key decisions) | Per-step retros for S13 and S15 exist in the private evidence folder |

## Done

- B3, C2, C3 (2026-11-19): B3: zh `rt.fresh` is now "最新", as in ja. C2: `scripts/sync_publish.sh` compares (dry run, default) or copies (`--apply`) the two publisher config files to the VM; see `deploy/README.md`. C3: the page warns (`machine-config`, a count only) when Beszel returns systems that `[beszel.map]` does not list; checklist in `docs/runbooks/install-beszel-agent.md`.
- C7 (2026-11-18): Windows task runs `pythonw.exe`; no console window (no conhost child), `LastTaskResult` 0, `probe.log` shows `(no console)` and `pushed: {"ok": true ...}`.
- A1, A2 (2026-11-19): not data bugs. The README screenshots `machines.png` and `overview.png` were taken while the KPI numbers were still rolling up (0.9 s); the live page settles on the same value as the panel title and the per-agent line ("205 req/session" in the same shot is 818 / 4). Fix: retake the screenshots after the roll.
- A3 (2026-11-19): a machine whose label equals its own public code is exempt from the private-name list (exporter and gate, judged per machine; a non-code id stays private); the code clash check compares normalised names on both sides.
- Publisher stop (2026-11-19, 12:10 to deploy): the owner's profile repo (public, no separators) also appeared as a part of a private branch, so the gate saw one name as both public and private. A branch part that spells a public repo name, in any case, is no longer a private name (exporter and gate).
