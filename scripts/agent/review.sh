#!/usr/bin/env bash
# Cross-vendor review of the current branch against its base.
#
#   scripts/agent/review.sh [--author claude|codex|cursor|human] [--base origin/dev]
#                           [--pane <herdr pane id>] [--machine <herdr machine>] [--with-codex] [--with-cursor]
#
# Runs the reviewers that did NOT write the code, headless, and writes reports to
# .review/<branch>/<vendor>.md (gitignored). With --pane, also starts Claude interactively
# in that herdr pane running /pubky-review so you can talk to the reviewer.
#
# Always runs (deterministic): pnpm check.
# kimi    : scripts/agent/review-kimi.sh (OpenRouter, needs OPENROUTER_API_KEY); default second reviewer
# claude  : /pubky-review via the project skill (security auditor + clean-code reviewer)
# codex   : codex review with .github/prompts/review.md (only with --with-codex)
# cursor  : cursor-agent in plan mode with the same prompt (only with --with-cursor)
set -euo pipefail

author="human" base="origin/dev" pane="" machine="" with_codex="" with_cursor=""
while [ $# -gt 0 ]; do
  case "$1" in
    --author) author="$2"; shift 2 ;;
    --base) base="$2"; shift 2 ;;
    --pane) pane="$2"; shift 2 ;;
    --machine) machine="$2"; shift 2 ;;
    --with-codex) with_codex=1; shift ;;
    --with-cursor) with_cursor=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

root=$(git rev-parse --show-toplevel)
cd "$root"
branch=$(git rev-parse --abbrev-ref HEAD)
out=".review/$branch"
mkdir -p "$out"
grep -qx '.review/' .gitignore 2>/dev/null || echo '.review/' >> .gitignore

git fetch -q origin
merge_base=$(git merge-base HEAD "$base")
git diff "$merge_base"...HEAD > "$out/diff.patch"
files=$(git diff --name-only "$merge_base"...HEAD | tr '\n' ' ')
echo "reviewing $branch vs $base ($(git diff --shortstat "$merge_base"...HEAD))"

echo "== pnpm check"
if pnpm check > "$out/check.log" 2>&1; then echo "check: green"; else echo "check: FAILED (see $out/check.log)"; fi

run_claude() {
  echo "== claude (/pubky-review)"
  claude -p "Run the pubky-review skill on the current branch against $base. Changed files: $files. Output the full report." \
    --output-format text --max-turns 60 > "$out/claude.md" 2>&1 && echo "claude: $out/claude.md" || echo "claude: failed (see $out/claude.md)"
}
run_kimi() {
  echo "== kimi (OpenRouter)"
  if [ -z "${OPENROUTER_API_KEY:-}" ]; then echo "kimi: skipped (OPENROUTER_API_KEY unset)"; return; fi
  gh pr view --json body -q .body > "$out/pr-body.md" 2>/dev/null || printf '(no PR yet)\n' > "$out/pr-body.md"
  scripts/agent/review-kimi.sh --base "$base" --pr-body "$out/pr-body.md" --out "$out/kimi.md" || echo "kimi: failed"
}
run_codex() {
  echo "== codex review"
  codex review --base "$base" "$(cat .github/prompts/review.md)" > "$out/codex.md" 2>&1 \
    && echo "codex: $out/codex.md" || echo "codex: failed (see $out/codex.md)"
}
run_cursor() {
  echo "== cursor-agent (plan mode)"
  cursor-agent --print --mode plan --output-format text \
    "$(cat .github/prompts/review.md) The diff to review is in $out/diff.patch against $base." \
    > "$out/cursor.md" 2>&1 && echo "cursor: $out/cursor.md" || echo "cursor: failed (see $out/cursor.md)"
}

case "$author" in
  claude) run_kimi ;;
  codex|cursor|human) run_kimi; run_claude ;;
  *) echo "unknown author: $author" >&2; exit 1 ;;
esac
[ -n "$with_codex" ] && [ "$author" != "codex" ] && run_codex
[ -n "$with_cursor" ] && [ "$author" != "cursor" ] && command -v cursor-agent >/dev/null && run_cursor

if [ -n "$pane" ]; then
  h() { if [ -n "$machine" ]; then herdr --machine "$machine" "$@"; else herdr "$@"; fi; }
  h agent start "review-${branch//\//-}" --kind claude --pane "$pane" --timeout 120000 >/dev/null
  h agent prompt "review-${branch//\//-}" "/pubky-review $base" >/dev/null || true
  echo "interactive reviewer started in pane $pane"
fi

echo
echo "reports in $out/. Read the Verdict sections first:"
grep -H -A1 '^## Verdict' "$out"/*.md 2>/dev/null || true
