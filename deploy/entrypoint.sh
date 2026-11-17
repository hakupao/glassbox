#!/bin/sh
# Container entrypoint.
# 1. Turns every file in /run/secrets into an upper-case environment variable
#    (github_token -> GITHUB_TOKEN), because the hub reads tokens from the environment
#    (hub.toml names the variable: token_env / password_env). The values live only in
#    this process's environment, never in compose.yaml or the image.
# 2. Runs `hub collect all` every GLASSBOX_COLLECT_INTERVAL seconds in the background
#    (the hub's `serve` command only receives probe reports; collectors are a separate command).
# 3. Replaces itself with `hub serve`.
set -eu

if [ -d /run/secrets ]; then
  for f in /run/secrets/*; do
    [ -f "$f" ] || continue
    name=$(basename "$f" | tr 'a-z-' 'A-Z_')
    export "$name=$(cat "$f")"
  done
fi

CONFIG="${GLASSBOX_CONFIG:-/etc/glassbox/hub.toml}"
INTERVAL="${GLASSBOX_COLLECT_INTERVAL:-300}"

(
  while true; do
    sleep "$INTERVAL"
    python -m hub --config "$CONFIG" collect all || echo "collect failed" >&2
  done
) &

exec python -m hub --config "$CONFIG" serve
