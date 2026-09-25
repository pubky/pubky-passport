#!/usr/bin/env bash
# Claude Code PreToolUse hook for Bash. Blocks commands that AGENTS.md forbids for agents.
# Exit 2 = block the tool call and show the reason to the agent. Exit 0 = allow.
set -euo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
[ -n "$cmd" ] || exit 0

block() {
  printf 'Blocked by scripts/agent/guard-bash.sh: %s\nSee AGENTS.md "How to work".\n' "$1" >&2
  exit 2
}

# Force pushes and history rewrites on shared branches.
if printf '%s' "$cmd" | grep -Eq 'git\s+push[^|;&]*(--force|-f\b|--force-with-lease)'; then
  block "force push"
fi
# Direct pushes to protected branches.
if printf '%s' "$cmd" | grep -Eq 'git\s+push[^|;&]*\s(origin\s+)?(dev|main)(\s|$|:)'; then
  block "direct push to dev/main; open a PR instead"
fi
if printf '%s' "$cmd" | grep -Eq 'git\s+push[^|;&]*\s(origin\s+)?HEAD:(dev|main)(\s|$)'; then
  block "direct push to dev/main; open a PR instead"
fi
# Secrets and certificates.
if printf '%s' "$cmd" | grep -Eq '(^|[^A-Za-z0-9_./-])\.env\.local([^A-Za-z0-9_-]|$)' && ! printf '%s' "$cmd" | grep -Eq '^\s*(ls|test|stat)\b'; then
  block "touching .env.local"
fi
if printf '%s' "$cmd" | grep -Eq '(^|\s)certificates/'; then
  block "touching certificates/"
fi
if printf '%s' "$cmd" | grep -Eq 'gh\s+secret\s+(set|delete|remove)'; then
  block "changing repository secrets"
fi
# Destructive git and filesystem operations.
if printf '%s' "$cmd" | grep -Eq 'git\s+(reset\s+--hard|clean\s+-[a-zA-Z]*f|branch\s+-D|checkout\s+--\s+\.)'; then
  block "destructive git operation"
fi
if printf '%s' "$cmd" | grep -Eq 'rm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+(/|~|\$HOME|\.\.|\.)(\s|$)'; then
  block "recursive delete of a root, home, or the repository"
fi
exit 0
