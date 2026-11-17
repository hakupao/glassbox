#!/bin/sh
# Container entrypoint.
# 1. Turns every file in $GLASSBOX_SECRETS_DIR (default /run/secrets) into an upper-case environment variable
#    (github_token -> GITHUB_TOKEN), because the hub reads tokens from the environment
#    (hub.toml names the variable: token_env / password_env). A secret file that cannot be
#    read, or is empty, stops the container; only the file name is printed, never a value.
# 2. With arguments, runs `python -m hub --config <config> <args>` and exits, so that
#    `docker exec glassbox glassbox-entrypoint collect all` sees the same environment
#    as the server. `check-secrets` prints which secret variables are set (no values).
# 3. Without arguments: runs `hub collect all` once at start and then every
#    GLASSBOX_COLLECT_INTERVAL seconds in the background (`serve` only receives probe
#    reports), and replaces itself with `hub serve`.
set -eu

SECRETS_DIR="${GLASSBOX_SECRETS_DIR:-/run/secrets}"
if [ -d "$SECRETS_DIR" ]; then
  for f in "$SECRETS_DIR"/*; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    name=$(printf '%s' "$base" | tr 'a-z-' 'A-Z_')
    if ! val=$(cat "$f" 2>/dev/null); then
      echo "cannot read secret file: $base (owner/mode must let uid $(id -u) read it)" >&2
      exit 1
    fi
    if [ -z "$val" ]; then
      echo "secret file is empty: $base" >&2
      exit 1
    fi
    export "$name=$val"
    SECRET_NAMES="${SECRET_NAMES:-} $name"
  done
fi

CONFIG="${GLASSBOX_CONFIG:-/etc/glassbox/hub.toml}"

if [ "${1:-}" = "check-secrets" ]; then
  for n in ${SECRET_NAMES:-}; do echo "$n: set"; done
  exit 0
fi

if [ $# -gt 0 ]; then
  exec python -m hub --config "$CONFIG" "$@"
fi

INTERVAL="${GLASSBOX_COLLECT_INTERVAL:-300}"
case "$INTERVAL" in
  ''|*[!0-9]*) echo "GLASSBOX_COLLECT_INTERVAL must be a number of seconds" >&2; exit 1 ;;
esac

(
  while true; do
    python -m hub --config "$CONFIG" collect all || echo "collect failed" >&2
    sleep "$INTERVAL"
  done
) &

exec python -m hub --config "$CONFIG" serve
