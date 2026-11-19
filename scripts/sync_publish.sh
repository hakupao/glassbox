#!/usr/bin/env bash
# Sync the public-snapshot config from the dev clone's .local/ to the deploy VM.
# Usage: GLASSBOX_VM_EXEC='<command prefix that runs a command on the VM>' scripts/sync_publish.sh [--show-diff] [--apply]
# Default is a dry run that prints "same" / "differs (N lines)" per file and never prints contents.
set -euo pipefail

usage() { echo "usage: GLASSBOX_VM_EXEC='<command prefix>' $0 [--show-diff] [--apply]" >&2; exit 2; }
[ -n "${GLASSBOX_VM_EXEC:-}" ] || usage

show=0; apply=0
for a in "$@"; do
  case "$a" in
    --show-diff) show=1 ;;
    --apply) apply=1 ;;
    *) usage ;;
  esac
done

root="$(cd "$(dirname "$0")/.." && pwd)"
py="${PYTHON:-python3.12}"
command -v "$py" >/dev/null 2>&1 || py="$HOME/.local/bin/python3.12"
pairs=(".local/public.local.toml:/opt/glassbox/publish/public.toml"
       ".local/redact_terms.local.json:/opt/glassbox/publish/terms.json")
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# word-splitting of the prefix is intended (it is a command prefix)
vm() { # shellcheck disable=SC2086
  $GLASSBOX_VM_EXEC "$@"; }

if [ "$apply" = 1 ]; then
  "$py" -c 'import sys, tomllib; tomllib.load(open(sys.argv[1], "rb"))' "$root/.local/public.local.toml"
  "$py" -c 'import sys, json; json.load(open(sys.argv[1]))' "$root/.local/redact_terms.local.json"
fi

# Phase 1: fetch and compare every file before anything is written. A remote file that cannot be
# read counts as missing (dry run reports it; --apply creates it).
vm true || { echo "cannot reach the VM through GLASSBOX_VM_EXEC" >&2; exit 1; }
n=0; todo=()
for pair in "${pairs[@]}"; do
  loc="$root/${pair%%:*}"; rem="${pair#*:}"; n=$((n + 1)); got="$tmp/remote.$n"
  [ -f "$loc" ] || { echo "$(basename "$loc"): local file missing" >&2; exit 1; }
  if ! vm sudo test -e "$rem"; then
    : > "$got"; echo "$rem: missing on the VM"; todo+=("$loc:$rem"); continue
  fi
  vm sudo cat "$rem" > "$got"
  if cmp -s "$loc" "$got"; then echo "$rem: same"; continue; fi
  lines="$(diff "$got" "$loc" | grep -c '^[<>]' || true)"
  echo "$rem: differs ($lines lines)"
  [ "$show" = 1 ] && { diff -u "$got" "$loc" || true; }
  todo+=("$loc:$rem")
done
[ "$apply" = 1 ] || exit 0

# Phase 2: write each file through a temp file that is 0640 root:10002 from the start (contents are
# private; tee into a new file would follow root's umask), then install it in place.
done_list=()
fail() {
  vm sudo rm -f "$1.new" || true
  echo "$1: apply failed; already updated: ${done_list[*]:-none}" >&2; exit 1
}
for pair in ${todo[@]+"${todo[@]}"}; do
  loc="${pair%%:*}"; rem="${pair#*:}"; got="$tmp/check"
  vm sudo install -o root -g 10002 -m 0640 /dev/null "$rem.new" || fail "$rem"
  vm sudo tee "$rem.new" < "$loc" > /dev/null || fail "$rem"   # install /dev/stdin failed before
  vm sudo install -o root -g 10002 -m 0640 "$rem.new" "$rem" || fail "$rem"
  vm sudo rm -f "$rem.new" || fail "$rem"
  vm sudo cat "$rem" > "$got" && cmp -s "$loc" "$got" || fail "$rem"
  done_list+=("$rem"); echo "$rem: applied, identical"
done
