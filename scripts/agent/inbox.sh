#!/usr/bin/env bash
# Read the steward's feedback for the current branch from the shared mailbox.
#
#   scripts/agent/inbox.sh            print the latest feedback
#   scripts/agent/inbox.sh --wait     block until feedback newer than the last handoff arrives (max 3h)
#   scripts/agent/inbox.sh --follow   keep printing new feedback as it arrives (for a side pane)
set -euo pipefail
AGENTS_ROOT="${AGENTS_ROOT:-/srv/agents}"
MAILBOX="${MAILBOX:-$AGENTS_ROOT/mailbox}"
mode="${1:-latest}"
root=$(git rev-parse --show-toplevel); cd "$root"
b=$(git rev-parse --abbrev-ref HEAD); box="$MAILBOX/$b"
latest() { { ls -1 "$box"/feedback-*.md 2>/dev/null || true; } | sort | tail -n 1; }
case "$mode" in
  latest)
    f=$(latest); [ -n "$f" ] || { echo "no feedback yet for $b"; exit 0; }
    cat "$f" ;;
  --wait)
    since="$box/meta.json"; [ -f "$since" ] || { echo "no handoff recorded for $b; run scripts/agent/handoff.sh first" >&2; exit 1; }
    deadline=$(( $(date +%s) + 3*3600 ))
    while :; do
      f=$(latest)
      if [ -n "$f" ] && [ "$f" -nt "$since" ]; then cat "$f"; exit 0; fi
      [ "$(date +%s)" -lt "$deadline" ] || { echo "timed out waiting for steward feedback on $b" >&2; exit 1; }
      sleep 20
    done ;;
  --follow)
    seen=""; echo "following steward feedback for $b ..."
    while :; do
      f=$(latest)
      if [ -n "$f" ] && [ "$f" != "$seen" ]; then printf '\n===== %s =====\n' "$(basename "$f")"; cat "$f"; seen="$f"; fi
      sleep 20
    done ;;
  *) sed -n '2,6p' "$0"; exit 1 ;;
esac
