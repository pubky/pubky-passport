---
name: pubky-review
description: Run a combined Pubky code review on a diff by launching the pubky-security-auditor and clean-code-reviewer subagents in parallel, then merging and verifying their findings into one prioritized report. Use when the user asks to review changes, audit a branch or PR, or says /pubky-review.
disable-model-invocation: true
icon: shield
color: purple
---

# Pubky review

Orchestrates the review subagents on one diff and returns a single, deduplicated report.

## Steps

1. Determine scope, in this order of preference: what the user named → PR number (`gh pr diff <n>`) → current branch vs its base (`git merge-base HEAD origin/main` or `origin/master`) → staged + unstaged changes. Record the repo path, base ref, and the list of changed files.
2. Collect context the subagents cannot see: repo `AGENTS.md`/`CLAUDE.md` path, the repo's check command (`pnpm check`, `cargo nextest run`, `just check`), and a two-sentence summary of the change's intent from commit messages or the user.
3. Launch both subagents with the Task tool in a single message so they run in parallel. Each prompt must include: repo path, base ref, changed file list, change intent, the context files to read, and the instruction to return findings in their own output template.
   - `pubky-security-auditor`
   - `clean-code-reviewer`
4. Merge results:
   - Deduplicate findings that point at the same file:line; keep the higher severity and the better fix.
   - Verify every Critical/High/Blocking finding by opening the cited code yourself. Drop or downgrade anything that does not hold.
   - Map severities onto one scale: Critical, High, Medium, Low/Nit.
5. Report using the template below. Do not apply fixes unless the user asked for review-and-fix; if they did, fix Critical/High first, rerun the repo's check command, and report what changed.

## Report template

```
# Review — <repo> @ <branch or PR> (<n> files)

## Verdict
<Ready to merge | Needs changes | Blocked> — one sentence why.

## Critical
- <file:line> — <issue>. <exploit path or impact>. Fix: <specific>. (source: security | clean-code)

## High
## Medium
## Low / nits

## Verified safe
- <boundaries and properties the auditor confirmed>

## Not covered
- <areas neither subagent could reach, e.g. runtime behavior needing the local stack>
```

Keep findings concrete (file:line and code). If both subagents come back clean, say so and list what was verified.
