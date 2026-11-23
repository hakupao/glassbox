#!/usr/bin/env bash
# Take the five README screenshots (en, 1440x900) from a glassbox page.
# Usage: scripts/screenshots.sh [base-url] [out-dir]
#   base-url  default https://status.bojiang.org (the public snapshot linked from the README)
#   out-dir   default docs/screenshots
# Every shot loads the page with ?t=8, the page's own still frame (web/app.js FROZEN / G.STATIC): the
# KPI numbers skip their roll and show final values, and the background art and sparks are drawn once
# at t = 8 s, the same frame reduced motion gets. Needs Node; the browser comes from Playwright
# 1.65.0 (first run: `npx -y playwright@1.65.0 install chromium`). PLAYWRIGHT overrides the command, e.g.
# PLAYWRIGHT='node /path/to/playwright/cli.js'; PW_ARGS adds options, e.g. PW_ARGS=--channel=chrome to
# use the installed Chrome instead of a downloaded browser.
set -euo pipefail

base="${1:-https://status.bojiang.org}"
base="${base%/}"
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${2:-$root/docs/screenshots}"
pw="${PLAYWRIGHT:-npx -y playwright@1.65.0}"
mkdir -p "$out"

for pair in overview: usage:usage code:code machines:machines services:services; do
  name="${pair%%:*}" route="${pair#*:}"
  # word-splitting of $pw is intended (it is a command)
  # shellcheck disable=SC2086
  $pw screenshot ${PW_ARGS:-} --viewport-size=1440,900 --lang=en-US \
    --wait-for-selector='#view .pn' --wait-for-timeout=1500 \
    "$base/?lang=en&t=8#/$route" "$out/$name.png" >/dev/null
  echo "$out/$name.png"
done
