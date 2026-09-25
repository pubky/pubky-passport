#!/usr/bin/env bash
# Open one feature as a herdr workspace: a git worktree, three panes, and the implementer started.
#
#   scripts/agent/feature.sh <slug> [--vendor claude|codex|cursor] [--base dev] [--machine <herdr machine>]
#                            [--issue <n>] [--prompt "<text>"]
#
# Pane layout (tab 1 of the new workspace):
#   left  : implementer agent (pane p_impl)
#   right : shell for pnpm check / dev server (pane p_shell)
#   below : reserved for the reviewer, started later by scripts/agent/review.sh
#
# With --machine the whole thing runs on a saved herdr SSH machine (a Coder workspace) and
# paths are resolved there. Without it, runs in the local herdr session.
set -euo pipefail

slug="" vendor="claude" base="dev" machine="" issue="" prompt=""
while [ $# -gt 0 ]; do
  case "$1" in
    --vendor) vendor="$2"; shift 2 ;;
    --base) base="$2"; shift 2 ;;
    --machine) machine="$2"; shift 2 ;;
    --issue) issue="$2"; shift 2 ;;
    --prompt) prompt="$2"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) slug="$1"; shift ;;
  esac
done
[ -n "$slug" ] || { echo "usage: $0 <slug> [--vendor claude|codex|cursor] [--base dev] [--machine <m>] [--issue <n>] [--prompt <text>]" >&2; exit 1; }
case "$vendor" in claude|codex|cursor) ;; *) echo "unknown vendor: $vendor" >&2; exit 1 ;; esac

h() { if [ -n "$machine" ]; then herdr --machine "$machine" "$@"; else herdr "$@"; fi; }
if [ -z "$machine" ]; then
  [ "${HERDR_ENV:-}" = 1 ] || herdr status >/dev/null 2>&1 || { echo "herdr server is not running; start herdr first" >&2; exit 1; }
fi

branch="feat/$slug"
repo_root="${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
if [ -n "$machine" ]; then repo_root="${REMOTE_REPO_ROOT:-~/pubky-passport}"; fi

echo "creating worktree $branch from $base in a new herdr workspace..."
created=$(h worktree create --cwd "$repo_root" --branch "$branch" --base "$base" --label "$slug" --no-focus --trust-repository)
ws=$(printf '%s' "$created" | jq -r '.result.workspace.workspace_id // .result.workspace.id // .result.workspace')
root=$(printf '%s' "$created" | jq -r '.result.root_pane.pane_id // .result.root_pane.id // .result.root_pane')
wt=$(printf '%s' "$created" | jq -r '.result.worktree.path // .result.path // empty')
[ -n "$ws" ] && [ -n "$root" ] || { echo "unexpected herdr response:" >&2; printf '%s\n' "$created" >&2; exit 1; }

shell=$(h pane split --pane "$root" --direction right --ratio 0.4 --no-focus | jq -r '.result.pane.pane_id // .result.pane.id // .result.pane')
review=$(h pane split --pane "$shell" --direction down --ratio 0.5 --no-focus | jq -r '.result.pane.pane_id // .result.pane.id // .result.pane')
h pane rename "$root" "impl-$vendor" >/dev/null 2>&1 || true
h pane rename "$shell" "shell" >/dev/null 2>&1 || true
h pane rename "$review" "review" >/dev/null 2>&1 || true

h pane run "$shell" "pnpm install --frozen-lockfile" >/dev/null

echo "starting $vendor as implementer in $root..."
h agent start "impl-$slug" --kind "$vendor" --pane "$root" --timeout 120000 >/dev/null

if [ -z "$prompt" ]; then
  prompt="You are implementing feature '$slug' on branch $branch."
  [ -n "$issue" ] && prompt="$prompt The specification is GitHub issue #$issue (read it with gh issue view $issue)."
  prompt="$prompt Read AGENTS.md, docs/security/threat-model.md and the relevant ADR in docs/adr first. Produce a short plan (files, tests, boundaries touched) and wait for my approval before writing code. After approval: implement, run pnpm check, and report the result verbatim. Do not open a PR."
fi
h agent prompt "impl-$slug" "$prompt" --wait --until blocked --until idle --until done --timeout 900000 >/dev/null || true

cat <<MSG
workspace: $ws   worktree: ${wt:-see herdr}
panes:     impl=$root  shell=$shell  review=$review
agent:     impl-$slug ($vendor)

Next: read the plan with   herdr${machine:+ --machine $machine} agent read impl-$slug
      approve with         herdr${machine:+ --machine $machine} agent prompt impl-$slug "Approved, go ahead."
      when done, review:   scripts/agent/review.sh --pane $review --author $vendor${machine:+ --machine $machine}
MSG
