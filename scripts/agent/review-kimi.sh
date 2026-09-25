#!/usr/bin/env bash
# Independent review of the current branch by Kimi via OpenRouter.
#
#   scripts/agent/review-kimi.sh [--base <ref>] [--out <file>] [--pr-body <file>] [--via opencode|api]
#
# --via opencode (default when `opencode` is installed and has an openrouter login): runs the
#   repo's read-only `reviewer` agent (.opencode/agents/reviewer.md), so Kimi can read files.
# --via api: one OpenRouter chat completion with AGENTS.md, the threat model, the PR body, and
#   the diff inline. Used in CI. Needs OPENROUTER_API_KEY, or falls back to the key OpenCode
#   stored with `opencode auth login` (~/.local/share/opencode/auth.json).
# Model from KIMI_MODEL (default moonshotai/kimi-k3).
set -euo pipefail

base="origin/dev" out="" pr_body="" via=""
while [ $# -gt 0 ]; do
  case "$1" in
    --base) base="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --pr-body) pr_body="$2"; shift 2 ;;
    --via) via="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done
model="${KIMI_MODEL:-moonshotai/kimi-k3}"
opencode_auth="$HOME/.local/share/opencode/auth.json"
if [ -z "$via" ]; then
  if command -v opencode >/dev/null && [ -f "$opencode_auth" ] && jq -e '.openrouter' "$opencode_auth" >/dev/null 2>&1; then via=opencode; else via=api; fi
fi

if [ "$via" = "opencode" ]; then
  root=$(git rev-parse --show-toplevel); cd "$root"
  body="(no PR description)"; [ -n "$pr_body" ] && [ -s "$pr_body" ] && body=$(cat "$pr_body")
  msg=$(printf 'Review the current branch against %s. Use `git diff %s...HEAD` for the change.\n\nPR description:\n\n%s\n' "$base" "$base" "$body")
  if [ -n "$out" ]; then
    opencode run --agent reviewer -m "openrouter/$model" "$msg" > "$out" 2>/dev/null && echo "review written to $out (opencode/$model)"
  else
    opencode run --agent reviewer -m "openrouter/$model" "$msg" 2>/dev/null
  fi
  exit
fi

if [ -z "${OPENROUTER_API_KEY:-}" ] && [ -f "$opencode_auth" ]; then
  OPENROUTER_API_KEY=$(jq -r '.openrouter.key // empty' "$opencode_auth")
fi
: "${OPENROUTER_API_KEY:?OPENROUTER_API_KEY is not set and OpenCode has no openrouter login}"
max_diff_chars="${KIMI_MAX_DIFF_CHARS:-600000}"

root=$(git rev-parse --show-toplevel); cd "$root"
merge_base=$(git merge-base HEAD "$base")
diff=$(git diff "$merge_base"...HEAD)
if [ "${#diff}" -gt "$max_diff_chars" ]; then
  diff="${diff:0:$max_diff_chars}

[diff truncated at $max_diff_chars characters; review what is shown and say so in the verdict]"
fi
[ -n "$diff" ] || { echo "nothing to review: no diff against $base" >&2; exit 1; }
body="(no PR description)"; [ -n "$pr_body" ] && [ -s "$pr_body" ] && body=$(cat "$pr_body")

system=$(cat .github/prompts/review.md)
user=$(printf '# AGENTS.md\n\n%s\n\n# docs/security/threat-model.md\n\n%s\n\n# PR description\n\n%s\n\n# Diff against %s\n\n```diff\n%s\n```\n' \
  "$(cat AGENTS.md)" "$(cat docs/security/threat-model.md)" "$body" "$base" "$diff")

payload=$(jq -n --arg model "$model" --arg system "$system" --arg user "$user" '{
  model: $model,
  temperature: 0.2,
  max_tokens: 8000,
  messages: [ { role: "system", content: $system }, { role: "user", content: $user } ]
}')

response=$(curl -sS --fail-with-body --max-time 900 https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -H "HTTP-Referer: https://github.com/pubky/pubky-passport" \
  -H "X-Title: pubky-passport review" \
  --data-binary "$payload") || { echo "OpenRouter request failed:" >&2; printf '%s\n' "$response" | head -c 2000 >&2; exit 1; }

content=$(printf '%s' "$response" | jq -r '.choices[0].message.content // empty')
if [ -z "$content" ]; then
  echo "OpenRouter returned no content:" >&2; printf '%s' "$response" | jq -r '.error.message // .' 2>/dev/null | head -c 2000 >&2; exit 1
fi
usage=$(printf '%s' "$response" | jq -r '"\(.usage.prompt_tokens // "?") in / \(.usage.completion_tokens // "?") out"')
header="<!-- reviewer: $model; tokens: $usage -->"
if [ -n "$out" ]; then printf '%s\n%s\n' "$header" "$content" > "$out"; echo "review written to $out ($usage)"; else printf '%s\n%s\n' "$header" "$content"; fi
