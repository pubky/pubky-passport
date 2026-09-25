#!/usr/bin/env bash
# Implementer side: push the current branch to the shared staging repo and tell the steward
# it is ready for verification, review, and publishing. Implementers hold no GitHub credentials.
#
#   scripts/agent/handoff.sh [--author claude|codex|cursor|opencode|human] [--issue <n>] [--body <pr-description.md>]
#
# Then: scripts/agent/inbox.sh --wait   (blocks until the steward answers)
set -euo pipefail
AGENTS_ROOT="${AGENTS_ROOT:-/srv/agents}"
STAGING="${STAGING:-$AGENTS_ROOT/staging.git}"
MAILBOX="${MAILBOX:-$AGENTS_ROOT/mailbox}"
author="${AGENT_VENDOR:-unknown}" issue="" body=""
while [ $# -gt 0 ]; do
  case "$1" in
    --author) author="$2"; shift 2 ;;
    --issue) issue="$2"; shift 2 ;;
    --body) body="$2"; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done
root=$(git rev-parse --show-toplevel); cd "$root"
b=$(git rev-parse --abbrev-ref HEAD)
case "$b" in dev|main|HEAD) echo "refusing to hand off '$b'; work on a feat/ fix/ chore/ branch" >&2; exit 1 ;; esac
[ -d "$STAGING" ] || { echo "staging repo $STAGING is not mounted in this workspace" >&2; exit 1; }
if [ -n "$(git status --porcelain)" ]; then echo "working tree has uncommitted changes; commit first" >&2; exit 1; fi
git remote get-url staging >/dev/null 2>&1 || git remote add staging "$STAGING"
git push -q --force staging "HEAD:refs/heads/$b"
box="$MAILBOX/$b"; mkdir -p "$box"
[ -n "$body" ] && [ -s "$body" ] && cp "$body" "$box/pr.md"
jq -n --arg author "$author" --arg issue "$issue" --arg head "$(git rev-parse HEAD)" --arg host "$(hostname)" \
  '{author:$author, issue:$issue, head:$head, host:$host, at:(now|todate)}' > "$box/meta.json"
: > "$box/ready"
echo "handed off $b@$(git rev-parse --short HEAD) to the steward (author: $author)."
echo "next: scripts/agent/inbox.sh --wait"
