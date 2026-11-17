#!/bin/sh
# glassbox statusline tap
#
# Wraps an existing Claude Code statusLine command. Records the account-wide
# `rate_limits` field from the statusline stdin JSON (Claude's only local
# source of quota data), then hands stdin unchanged to the real command.
#
# Usage (in ~/.claude/settings.json statusLine.command):
#   GLASSBOX_DATA=<dir> sh <path>/statusline-tap.sh <real command> [args...]
#
# Output: $GLASSBOX_DATA/claude_rate_limits.jsonl, one line per sample:
#   {"ts":<unix>,"sample":{"s":<session_id>,"r":<rate_limits>}}
# Sessions report independently and an idle one can lag, so readers should
# prefer the newest sample per window rather than trusting any single line.
# A sample is written only when the value changes, or every 10 min otherwise.
# Recording runs in the background and never blocks or breaks the statusline.

input=$(cat)

if [ -n "$GLASSBOX_DATA" ] && command -v jq >/dev/null 2>&1; then
  (
    rl=$(printf '%s' "$input" | jq -c 'if .rate_limits then {s: .session_id, r: .rate_limits} else empty end' 2>/dev/null)
    [ -n "$rl" ] || exit 0
    mkdir -p "$GLASSBOX_DATA" 2>/dev/null || exit 0
    last="$GLASSBOX_DATA/.claude_rate_limits.last"
    now=$(date +%s)
    if [ -f "$last" ]; then
      read -r last_ts last_rl < "$last"
      if [ "$last_rl" = "$rl" ] && [ $((now - ${last_ts:-0})) -lt 600 ]; then
        exit 0
      fi
    fi
    printf '{"ts":%s,"sample":%s}\n' "$now" "$rl" >> "$GLASSBOX_DATA/claude_rate_limits.jsonl"
    printf '%s %s\n' "$now" "$rl" > "$last"
  ) >/dev/null 2>&1 &
fi

printf '%s' "$input" | "$@"
