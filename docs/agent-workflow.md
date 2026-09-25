# Agent workflow

How features get built, reviewed, published, and merged in this repo with several AI vendors, a steward workspace that owns GitHub, and a human who decides. `AGENTS.md` holds the rules agents follow; this file holds the process.

## Roles and where they run

| Role           | Who                                                                                           | Where                                                                    | Credentials                                                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Implementer    | Claude Code, Codex CLI, cursor-agent, or OpenCode                                             | Coder workspaces `pp1`..`pp5` (template `pubky-dev`, role `implementer`) | Vendor logins only, done once per workspace. No GitHub access.                                                                                                                       |
| Steward        | `scripts/agent/steward.sh`, optionally driven by a Claude or OpenCode session                 | Coder workspace `steward` (role `steward`)                               | `gh auth login --with-token` with a fine-grained PAT (no Workflows permission) and `opencode auth login` for OpenRouter, both done by hand inside the workspace. Nothing is mounted. |
| Reviewers      | Kimi K3 via OpenRouter (OpenCode `reviewer` agent, read-only) and the Claude security auditor | On the steward and in CI                                                 | OpenCode login on the steward; `OPENROUTER_API_KEY` repository secret for CI                                                                                                         |
| Decision maker | Human                                                                                         | herdr on the laptop, attached to the machines                            | Everything, including `main`                                                                                                                                                         |

Rules: the vendor that wrote a branch never reviews it. Nothing an implementer says is trusted; the steward re-runs every check. Only the steward talks to GitHub, and it can only push feature branches and merge to `dev`.

## Shared plumbing on the devbox

`/srv/agents` on the host is mounted read-write into every workspace:

- `staging.git` is a bare repo. Implementers push their branches here; the steward fetches from here.
- `mailbox/<branch>/` carries `meta.json` (author, issue, head), `pr.md` (the implementer's PR description), a `ready` marker, the steward's `feedback-*.md` files, and `state.json`.

That is the whole inter-agent protocol. No agent needs SSH to another workspace, and a compromised implementer can only produce junk on staging.

Protocol knowledge comes from [pubky/agent-skills](https://github.com/pubky/agent-skills). The Coder template symlinks its skills into `~/.claude/skills`, `~/.codex/skills`, `~/.cursor/skills`, and `~/.config/opencode/skills`, and `.claude/settings.json` enables the `pubky` plugin for Claude Code. `opencode.json` sets Kimi K3 as OpenCode's default model here, and `.opencode/agents/reviewer.md` is the read-only reviewer the steward runs.

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

- `scripts/agent/review-kimi.sh` runs the OpenCode `reviewer` agent (Kimi K3, read-only, can read files) when OpenCode has an OpenRouter login, and otherwise makes one OpenRouter API call with `AGENTS.md`, the threat model, the PR description, and the diff inline, which is what CI does. About 60k tokens per review.
- `/pubky-review` runs the vendored security auditor and clean-code reviewer with Claude.
- `scripts/agent/review.sh --author <vendor>` runs whichever of the two did not write the code, plus `--with-codex` or `--with-cursor` if you want a third opinion locally.
- `security-audit.yml` runs Claude weekly on `dev` and files `security-audit` issues; `scripts/agent/audit.sh` is the local version.

## Guardrails

- `.claude/settings.json`: denies reading `.env.local`, certificates, `/run/secrets`, and credential files; denies edits to workflows, the guard, the steward script, and itself; runs `scripts/agent/guard-bash.sh` before every Bash command (blocks force pushes, pushes to `dev`/`main`, secret changes, destructive git and rm).
- Branch protection on `dev` and `main` (see `scripts/agent/rulesets.json`): PR required, checks required, no force push, no deletion. Applies to the steward token.
- The steward token has no Workflows permission, so pushes touching `.github/workflows` are rejected by GitHub for every agent. Humans push workflow changes.
- CI secrets are only exposed to same-repo, non-draft PRs.

## Authorization checklist

Nothing is mounted into workspaces except the shared `/srv/agents` tree. Every credential is a one-time login inside the workspace that owns it; the home volume keeps it across restarts.

| What                 | How                                                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Devbox plumbing      | `devbox-setup.sh` from the Coder templates folder, once (creates `/srv/agents` with the staging repo and mailbox)                                                                                                       |
| Steward: GitHub      | Inside `steward`: `gh auth login --with-token` with a fine-grained PAT for `pubky/pubky-passport` only, permissions Contents RW, Pull requests RW, Issues RW, Metadata R, no Workflows. Then `gh auth setup-git`.       |
| Steward: OpenRouter  | Inside `steward`: `opencode auth login`, pick OpenRouter, paste the key. `review-kimi.sh` and `steward.sh` read it from OpenCode.                                                                                       |
| Implementers         | Inside each `ppN`: `claude login`, `codex login --device-auth`, `cursor-agent login`, or `opencode auth login` for whichever vendors that workspace runs. No GitHub login.                                              |
| CI reviews and audit | `gh secret set OPENROUTER_API_KEY` and `gh secret set ANTHROPIC_API_KEY` on the repository                                                                                                                              |
| Branch protection    | `gh api -X POST repos/pubky/pubky-passport/rulesets --input scripts/agent/rulesets.json`                                                                                                                                |
| Workspaces and herdr | `coder templates push pubky-dev`, `coder create steward --template pubky-dev --parameter role=steward --parameter branch=dev`, `coder update ppN`, then on the laptop `herdr machine add --label steward herdr-steward` |
