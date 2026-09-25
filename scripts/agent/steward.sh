#!/usr/bin/env bash
# The steward: the only agent with GitHub credentials. It publishes implementer branches from
# the shared staging repo to GitHub, re-verifies them, runs the independent reviews, opens or
# updates the PR, relays feedback through the mailbox, and merges to dev when every gate is green.
#
#   scripts/agent/steward.sh publish <branch>   fetch from staging, pnpm check, review, push, open/update PR
#   scripts/agent/steward.sh merge <branch>     squash-merge the PR when CI and both reviews are green
#   scripts/agent/steward.sh status             mailbox state and open PRs
#   scripts/agent/steward.sh watch              loop: publish every ready branch, merge when green
#
# Environment (defaults suit the Coder steward workspace):
#   AGENTS_ROOT=/srv/agents           STAGING=$AGENTS_ROOT/staging.git   MAILBOX=$AGENTS_ROOT/mailbox
#   STEWARD_WORKTREES=~/steward-worktrees   STEWARD_AUTO_MERGE=dev|off (default dev)
#   STEWARD_INTERVAL=60 (seconds, watch loop)   Kimi reviews use OpenCode's openrouter login or OPENROUTER_API_KEY
set -euo pipefail

AGENTS_ROOT="${AGENTS_ROOT:-/srv/agents}"
STAGING="${STAGING:-$AGENTS_ROOT/staging.git}"
MAILBOX="${MAILBOX:-$AGENTS_ROOT/mailbox}"
STEWARD_WORKTREES="${STEWARD_WORKTREES:-$HOME/steward-worktrees}"
STEWARD_AUTO_MERGE="${STEWARD_AUTO_MERGE:-dev}"
STEWARD_INTERVAL="${STEWARD_INTERVAL:-60}"
BRANCH_RE='^(feat|fix|chore|docs|refactor|test)/[a-z0-9._-]+$'

root=$(git rev-parse --show-toplevel); cd "$root"
scripts="$root/scripts/agent"
log() { printf '[steward %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { log "error: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 is required"; }
need gh; need jq; need git

valid_branch() { [[ "$1" =~ $BRANCH_RE ]] || die "refusing branch '$1': must match $BRANCH_RE"; }
verdict_of() { [ -f "$1" ] && grep -m1 -A2 '^## Verdict' "$1" | tail -n +2 | grep -m1 -oE 'Ready to merge|Needs changes|Blocked' || echo "unknown"; }
ensure_staging_remote() {
  git remote get-url staging >/dev/null 2>&1 || git remote add staging "$STAGING"
}

publish() {
  local b="$1"; valid_branch "$b"
  local box="$MAILBOX/$b"; mkdir -p "$box"
  ensure_staging_remote
  git fetch -q origin dev
  git fetch -q staging "+refs/heads/$b:refs/remotes/staging/$b" || die "branch $b is not on staging"
  local head; head=$(git rev-parse "staging/$b")
  local wt="$STEWARD_WORKTREES/$b"; mkdir -p "$(dirname "$wt")"
  if [ -d "$wt" ]; then git -C "$wt" checkout -q -B "$b" "$head"; else git worktree add -q -B "$b" "$wt" "$head"; fi
  local out="$wt/.review/$b"; mkdir -p "$out"
  local author issue; author=$(jq -r '.author // "unknown"' "$box/meta.json" 2>/dev/null || echo unknown)
  issue=$(jq -r '.issue // ""' "$box/meta.json" 2>/dev/null || true)
  log "publishing $b@${head:0:8} (author: $author)"

  # 1. Deterministic gate, run here, never trusted from the implementer.
  local check="fail"
  ( cd "$wt" && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile >"$out/install.log" 2>&1 && pnpm check >"$out/check.log" 2>&1 ) && check="pass"
  log "pnpm check: $check"

  # 2. Independent reviews. Kimi (OpenRouter) and the Claude security auditor; never the author's vendor for Claude.
  local body="$box/pr.md"; [ -s "$body" ] || printf '## Intent\n\n(implementer did not provide a description)\n\n## Authored by\n\n%s\n' "$author" > "$body"
  local kimi_ok=""
  if [ "$author" = "opencode" ]; then log "author is opencode (Kimi); skipping Kimi self-review"
  elif ( cd "$wt" && "$scripts/review-kimi.sh" --base origin/dev --pr-body "$body" --out "$out/kimi.md" ); then kimi_ok=1
  else log "kimi review unavailable (no OpenRouter login?) or failed"; fi
  if [ "$author" != "claude" ] || [ -z "$kimi_ok" ]; then
    if command -v claude >/dev/null; then
      ( cd "$wt" && claude -p "Run the pubky-review skill on the current branch against origin/dev and output the full report." --output-format text --max-turns 60 >"$out/claude.md" 2>&1 ) || log "claude review failed"
    fi
  fi
  local vk vc; vk=$(verdict_of "$out/kimi.md"); vc=$(verdict_of "$out/claude.md")
  log "verdicts: kimi=$vk claude=$vc"

  # 3. Publish to GitHub. Only feature branches, never dev or main (valid_branch already enforced).
  ( cd "$wt" && git push -q --force-with-lease origin "$b" )
  local pr; pr=$(gh pr list --head "$b" --state open --json number -q '.[0].number' || true)
  local report="$out/steward-report.md"
  {
    printf '<!-- steward-report -->\n### Steward report for %s\n\n' "${head:0:8}"
    printf '| Gate | Result |\n| --- | --- |\n| pnpm check | %s |\n| Kimi review | %s |\n| Claude security review | %s |\n\n' "$check" "$vk" "$vc"
    [ "$check" = "pass" ] || { printf '<details><summary>pnpm check output (tail)</summary>\n\n```\n%s\n```\n</details>\n\n' "$(tail -n 60 "$out/check.log")"; }
    [ -f "$out/kimi.md" ] && printf '<details><summary>Kimi review</summary>\n\n%s\n</details>\n\n' "$(cat "$out/kimi.md")"
    [ -f "$out/claude.md" ] && printf '<details><summary>Claude security review</summary>\n\n%s\n</details>\n' "$(cat "$out/claude.md")"
  } > "$report"
  if [ -z "$pr" ]; then
    local title; title=$(git -C "$wt" log -1 --format=%s)
    [ -n "$issue" ] && title="$title (#$issue)"
    { cat "$body"; printf '\n\n---\n'; cat "$report"; } > "$out/pr-body.md"
    gh pr create --base dev --head "$b" --title "$title" --body-file "$out/pr-body.md" >/dev/null
    pr=$(gh pr list --head "$b" --state open --json number -q '.[0].number')
    log "opened PR #$pr"
  else
    gh pr comment "$pr" --body-file "$report" >/dev/null; log "updated PR #$pr"
  fi
  local url; url=$(gh pr view "$pr" --json url -q .url)

  # 4. Feedback to the implementer through the mailbox.
  local fb="$box/feedback-$(date +%Y%m%dT%H%M%S).md"
  { printf '# Steward feedback for %s (%s)\n\nPR: %s\n\n' "$b" "${head:0:8}" "$url"; cat "$report" | sed 's/<[^>]*>//g'; } > "$fb"
  rm -f "$box/ready"
  local state="published"; { [ "$check" = "pass" ] && [ "$vk" != "Needs changes" ] && [ "$vk" != "Blocked" ] && [ "$vc" != "Needs changes" ] && [ "$vc" != "Blocked" ]; } || state="needs-changes"
  jq -n --arg state "$state" --arg head "$head" --arg pr "$pr" --arg url "$url" --arg check "$check" --arg kimi "$vk" --arg claude "$vc" \
    '{state:$state, head:$head, pr:$pr, url:$url, check:$check, kimi:$kimi, claude:$claude, at:(now|todate)}' > "$box/state.json"
  log "$b -> $state ($url)"
}

merge() {
  local b="$1"; valid_branch "$b"
  local box="$MAILBOX/$b"; [ -f "$box/state.json" ] || die "no steward state for $b; publish first"
  [ "$STEWARD_AUTO_MERGE" = "dev" ] || die "STEWARD_AUTO_MERGE=$STEWARD_AUTO_MERGE; merges are manual"
  local state pr; state=$(jq -r .state "$box/state.json"); pr=$(jq -r .pr "$box/state.json")
  [ "$state" = "published" ] || { log "$b is $state; not merging"; return 1; }
  local base; base=$(gh pr view "$pr" --json baseRefName -q .baseRefName)
  [ "$base" = "dev" ] || die "PR #$pr targets $base; only dev is auto-merged"
  local head_now; head_now=$(gh pr view "$pr" --json headRefOid -q .headRefOid)
  [ "$head_now" = "$(jq -r .head "$box/state.json")" ] || { log "PR #$pr moved since review; republish"; return 1; }
  local checks; checks=$(gh pr checks "$pr" --json name,bucket 2>/dev/null || echo '[]')
  if ! jq -e 'length > 0 and all(.bucket == "pass" or .bucket == "skipping")' <<<"$checks" >/dev/null; then
    log "PR #$pr checks not green yet: $(jq -r 'map("\(.name)=\(.bucket)") | join(", ")' <<<"$checks")"; return 1
  fi
  local reviews; reviews=$(gh pr view "$pr" --json reviewDecision -q .reviewDecision)
  [ "$reviews" != "CHANGES_REQUESTED" ] || { log "PR #$pr has changes requested by a human"; return 1; }
  gh pr merge "$pr" --squash --delete-branch --subject "$(gh pr view "$pr" --json title -q .title) (#$pr)" >/dev/null
  jq '.state = "merged" | .merged_at = (now|todate)' "$box/state.json" > "$box/state.tmp" && mv "$box/state.tmp" "$box/state.json"
  printf '# Merged\n\nPR #%s was squash-merged into dev.\n' "$pr" > "$box/feedback-$(date +%Y%m%dT%H%M%S).md"
  git worktree remove --force "$STEWARD_WORKTREES/$b" 2>/dev/null || true
  log "merged PR #$pr ($b)"
}

status() {
  echo "mailbox ($MAILBOX):"
  for d in "$MAILBOX"/*/*/ "$MAILBOX"/*/; do
    [ -f "$d/meta.json" ] || continue
    local b; b=${d#"$MAILBOX/"}; b=${b%/}
    local st="new"; [ -f "$d/state.json" ] && st=$(jq -r '"\(.state) pr=\(.pr) check=\(.check) kimi=\(.kimi) claude=\(.claude)"' "$d/state.json")
    [ -f "$d/ready" ] && st="READY -> $st"
    printf '  %-40s %s\n' "$b" "$st"
  done
  echo "open PRs against dev:"; gh pr list --base dev --json number,title,headRefName,statusCheckRollup -q '.[] | "  #\(.number) \(.headRefName): \(.title)"'
}

watch() {
  log "watching $MAILBOX every ${STEWARD_INTERVAL}s (auto-merge: $STEWARD_AUTO_MERGE)"
  while true; do
    for marker in "$MAILBOX"/*/*/ready "$MAILBOX"/*/ready; do
      [ -f "$marker" ] || continue
      local d b; d=$(dirname "$marker"); b=${d#"$MAILBOX/"}
      publish "$b" || log "publish $b failed"
    done
    if [ "$STEWARD_AUTO_MERGE" = "dev" ]; then
      for st in "$MAILBOX"/*/*/state.json "$MAILBOX"/*/state.json; do
        [ -f "$st" ] || continue
        [ "$(jq -r .state "$st")" = "published" ] || continue
        local d b; d=$(dirname "$st"); b=${d#"$MAILBOX/"}
        merge "$b" || true
      done
    fi
    sleep "$STEWARD_INTERVAL"
  done
}

case "${1:-}" in
  publish) [ -n "${2:-}" ] || die "usage: steward.sh publish <branch>"; publish "$2" ;;
  merge) [ -n "${2:-}" ] || die "usage: steward.sh merge <branch>"; merge "$2" ;;
  status) status ;;
  watch) watch ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
