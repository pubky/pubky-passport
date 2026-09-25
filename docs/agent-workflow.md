# Agent workflow

How features get built, reviewed, published, and merged in this repo with several AI vendors, a steward workspace that owns GitHub, and a human who decides. `AGENTS.md` holds the rules agents follow; this file holds the process.

## Roles and where they run

| Role           | Who                                                               | Where                                                                    | Credentials                                                                       |
| -------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Implementer    | Claude Code, Codex CLI, or cursor-agent                           | Coder workspaces `pp1`..`pp5` (template `pubky-dev`, role `implementer`) | Vendor login only. No GitHub access.                                              |
| Steward        | `scripts/agent/steward.sh`, optionally driven by a Claude session | Coder workspace `steward` (role `steward`)                               | Fine-grained GitHub token (no Workflows permission), OpenRouter key, Claude login |
| Reviewers      | Kimi K3 via OpenRouter, Claude security auditor                   | On the steward and in CI                                                 | API keys on the steward and as repository secrets                                 |
| Decision maker | Human                                                             | herdr on the laptop, attached to the machines                            | Everything, including `main`                                                      |

Rules: the vendor that wrote a branch never reviews it. Nothing an implementer says is trusted; the steward re-runs every check. Only the steward talks to GitHub, and it can only push feature branches and merge to `dev`.

## Shared plumbing on the devbox

`/srv/agents` on the host is mounted read-write into every workspace:

- `staging.git` is a bare repo. Implementers push their branches here; the steward fetches from here.
- `mailbox/<branch>/` carries `meta.json` (author, issue, head), `pr.md` (the implementer's PR description), a `ready` marker, the steward's `feedback-*.md` files, and `state.json`.

That is the whole inter-agent protocol. No agent needs SSH to another workspace, and a compromised implementer can only produce junk on staging.

Protocol knowledge comes from [pubky/agent-skills](https://github.com/pubky/agent-skills). The Coder template symlinks its skills into `~/.claude/skills`, `~/.codex/skills`, and `~/.cursor/skills`, and `.claude/settings.json` enables the `pubky` plugin for Claude Code.

## Per-feature loop

1. **Issue.** Acceptance criteria, boundaries from `docs/security/threat-model.md`, answers to the ADR's open questions.
2. **Open the feature** from the laptop:
   ```bash
   scripts/agent/feature.sh custom-homegate --vendor claude --issue 42 --machine pp2
   ```
   Creates `feat/custom-homegate` as a worktree in a herdr workspace on pp2 with three panes: implementer, shell, and steward feedback (`inbox.sh --follow`). The implementer reads the docs and proposes a plan.
3. **Approve the plan** with `herdr --machine pp2 agent prompt impl-custom-homegate "Approved."`. The agent implements, runs `pnpm check`, writes `.review/pr.md`, and hands off with `scripts/agent/handoff.sh`.
4. **Steward publishes.** `steward.sh watch` (running in the steward workspace) sees the `ready` marker: fetches the branch, runs `pnpm check`, runs Kimi and the Claude auditor, pushes to GitHub, opens or updates the PR with a steward report, and writes feedback to the mailbox. The implementer, waiting in `inbox.sh --wait`, fixes what came back and hands off again.
5. **CI** runs quality, browser, Security, and the Kimi review comment on the PR.
6. **Merge.** When every check is green and both verdicts read "Ready to merge", the steward squash-merges into `dev` and deletes the branch. Anything else waits for you. A human review requesting changes always blocks. Release PRs from `dev` to `main` are yours.

Keep at most three features in flight.

## Steward commands

```bash
scripts/agent/steward.sh status            # mailbox state and open PRs
scripts/agent/steward.sh publish feat/x    # one branch, by hand
scripts/agent/steward.sh merge feat/x      # merge if green
scripts/agent/steward.sh watch             # the loop; run it in a tmux or herdr pane on the steward
STEWARD_AUTO_MERGE=off scripts/agent/steward.sh watch   # publish and review only, never merge
```

Talking to the steward as an agent: start Claude Code in the steward workspace. It has `gh` with the steward token and the same guard hooks, so it can inspect PRs, re-run publishes, and explain a verdict, but its pushes and merges still go through `steward.sh` and its allowlists.

## Reviews

- `scripts/agent/review-kimi.sh` sends `AGENTS.md`, the threat model, the PR description, and the diff to `moonshotai/kimi-k3` on OpenRouter with `.github/prompts/review.md`. About 60k tokens per review.
- `/pubky-review` runs the vendored security auditor and clean-code reviewer with Claude.
- `scripts/agent/review.sh --author <vendor>` runs whichever of the two did not write the code, plus `--with-codex` or `--with-cursor` if you want a third opinion locally.
- `security-audit.yml` runs Claude weekly on `dev` and files `security-audit` issues; `scripts/agent/audit.sh` is the local version.

## Guardrails

- `.claude/settings.json`: denies reading `.env.local`, certificates, `/run/secrets`, and credential files; denies edits to workflows, the guard, the steward script, and itself; runs `scripts/agent/guard-bash.sh` before every Bash command (blocks force pushes, pushes to `dev`/`main`, secret changes, destructive git and rm).
- Branch protection on `dev` and `main` (see `scripts/agent/rulesets.json`): PR required, checks required, no force push, no deletion. Applies to the steward token.
- The steward token has no Workflows permission, so pushes touching `.github/workflows` are rejected by GitHub for every agent. Humans push workflow changes.
- CI secrets are only exposed to same-repo, non-draft PRs.

## Authorization checklist

| What                       | How                                                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Devbox plumbing            | Run `devbox-setup.sh` from the Coder templates folder once as `gil` (creates `/srv/agents`, the bare repo, the mailbox, and the secrets directory)                                           |
| Steward GitHub token       | Fine-grained PAT, repository `pubky/pubky-passport` only, permissions: Contents RW, Pull requests RW, Issues RW, Metadata R. No Workflows. Save as `/srv/coder-secrets/github-token-steward` |
| OpenRouter key             | `/srv/coder-secrets/agent-auth/openrouter-key` (steward) and `gh secret set OPENROUTER_API_KEY` (CI)                                                                                         |
| Anthropic API key          | `gh secret set ANTHROPIC_API_KEY` for the weekly audit                                                                                                                                       |
| Claude Code in a workspace | Copy `~/.claude/.credentials.json` to `/srv/coder-secrets/agent-auth/claude-credentials.json`, or `claude login` inside the workspace                                                        |
| Codex CLI in a workspace   | Copy `~/.codex/auth.json` to `/srv/coder-secrets/agent-auth/codex-auth.json`, or `codex login --device-auth` inside the workspace                                                            |
| cursor-agent               | `cursor-agent login` on the laptop, then copy `~/.cursor/agent-cli-state.json` to `/srv/coder-secrets/agent-auth/cursor-agent-cli-state.json`                                                |
| Branch protection          | `gh api -X POST repos/pubky/pubky-passport/rulesets --input scripts/agent/rulesets.json`                                                                                                     |
| Workspaces                 | `coder templates push pubky-dev`, then `coder create steward --template pubky-dev --parameter role=steward`, and `coder update ppN` for the implementers                                     |
