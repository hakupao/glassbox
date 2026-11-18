# Backlog

Open items after S15 (2026-11-18). To be handled together; each one gets its own review before it ships.

## A. Data shown wrong

| # | Item | Where | Notes |
|---|---|---|---|
| A1 | Machine online count disagrees with itself: summary card says "4 / 5" with "all online", the panel title says "5 / 5 online" | Machines page | Find which count excludes what (probe vs Beszel online rule, CONTRACT §2) |
| A2 | Overview "Requests" total is smaller than its per-agent line (e.g. 623 vs Claude 818) | Overview, today's usage | Likely the public merge of private projects or a different time window between the two numbers |
| A3 | A machine without a `label` makes the public export fail ("code equals a private name"), so publishing stops | hub/export.py, scripts/verify_public.py | A label that equals its code reveals nothing; exempt it in both, keep the clash check for real names |

## B. UI

| # | Item | Notes |
|---|---|---|
| B1 | Background art: refine | Several versions to choose from |
| B2 | Machine mini charts: replay the 24 h history as a sliding window (one step per second, looping), like the reference site's public snapshot | Only when visible and without `prefers-reduced-motion`; show a small "replay" mark so it is not mistaken for live data |
| B3 | i18n: zh `rt.fresh` "正常" vs ja "最新" | Make the pair consistent |
| B4 | Activity view: learn from the reference site's activity feed (`#cat=activity&tab=feed`) | Ours is a flat commit list with a detail popup (`web/pages.js` `commitItem`). Reference: a vertical timeline grouped by day ("today, 6 changes"); each commit is a nested card (repo tag, short hash, "unpushed" badge, author, time, file list with M/A/R badges, "load more (17)", diff link); filter chips with counts (all / commits / pushed / unpushed ...); on phones a bottom tab bar, cards keep the timeline rail, long paths cut with an ellipsis; smooth expand and switch animations. Public snapshot rule still applies: private repo names and file paths must not leak, so the file list may be public-repo only or counts only. Take the design rules, not the components; first set them as variables and conventions in `web/styles.css`, then change the pages: (1) clear order inside a card (tags, title, author and time, files, actions), only 3 to 4 levels of size and color; (2) color only where things must be told apart (repo tag, file status, timeline dot), the rest in grays, badges small with pale fills; (3) monospace for data only (hashes, paths, times), body font for text; (4) a fixed spacing scale between and inside cards; (5) phone layout designed on its own: bottom tab bar, full-width segmented switch, paths cut with an ellipsis instead of wrapping; (6) long lists always folded ("load more (n)") so card height stays bounded |

## C. Operations

| # | Item | Notes |
|---|---|---|
| C1 | Publisher failure alert | Create an Uptime Kuma push monitor, put its URL in `/opt/glassbox/publish/kuma_push` (the code already reports to it) |
| C2 | Public config and term list exist twice: in the dev clone's `.local/` and in `/opt/glassbox/publish/` on the VM | Any change must be copied to the VM; document it or add a sync step |
| C3 | New machines in Beszel: add the read-only account to the system's `users`, add the `[beszel.map]` entry | Otherwise the hub silently drops the machine |
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

- C7 (2026-11-18): Windows task runs `pythonw.exe`; no console window (no conhost child), `LastTaskResult` 0, `probe.log` shows `(no console)` and `pushed: {"ok": true ...}`.
