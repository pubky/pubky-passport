#!/usr/bin/env bash
# Independent review of the current branch by Kimi via OpenRouter.
#
#   scripts/agent/review-kimi.sh [--base <ref>] [--out <file>] [--pr-body <file>]
#
# Needs OPENROUTER_API_KEY. Model from KIMI_MODEL (default moonshotai/kimi-k3).
# Sends AGENTS.md, the threat model, the PR body, and the diff; prints the review.
set -euo pipefail

base="origin/dev" out="" pr_body=""
while [ $# -gt 0 ]; do
  case "$1" in
    --base) base="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --pr-body) pr_body="$2"; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done
: "${OPENROUTER_API_KEY:?OPENROUTER_API_KEY is not set}"
model="${KIMI_MODEL:-moonshotai/kimi-k3}"
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
