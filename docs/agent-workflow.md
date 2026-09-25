# Agent workflow

How features get built, reviewed, and audited in this repo with several AI vendors and a human in the loop. AGENTS.md holds the rules agents follow; this file holds the process the human runs.

## Roles

| Role                | Who                                             | Where it runs                                       |
| ------------------- | ----------------------------------------------- | --------------------------------------------------- |
| Implementer         | Claude Code or Codex CLI (Cursor for UI-heavy)  | A Coder workspace, one herdr workspace per feature  |
| First review        | `/pubky-review` (security auditor + clean-code) | Same workspace, `review` pane                       |
| Cross-vendor review | The vendor that did not write the PR            | Locally via `scripts/agent/review.sh` and in CI     |
| Scheduled audit     | Claude, weekly, read-only                       | GitHub Actions (`security-audit.yml`) or `audit.sh` |
| Decision maker      | Human                                           | herdr on the laptop, attached to the Coder machines |

Rule: the vendor that wrote a PR never reviews it. Different model families miss different bugs.

## Environment

- Coder workspaces `pp1`..`pp5` on the devbox, template `pubky-dev`. Each has Claude Code, Codex CLI, cursor-agent, herdr, gh. Agent credentials are mounted read-only from `/srv/coder-secrets/agent-auth/` on the host and copied into the home volume on first start.
- herdr on the laptop has the workspaces saved as machines (`herdr machine list`). Every command below accepts `--machine <label>` to run on a workspace instead of locally.
- Branch protection on `dev` and `main`: PR required, CI + Security checks required, no force pushes. Agents cannot bypass this because workspaces hold no GitHub credentials beyond the read-only token.

## Per-feature loop

1. **Issue.** Write acceptance criteria and tick the boundaries from `docs/security/threat-model.md` it touches. If it needs a decision no ADR covers, write the ADR first (see `docs/adr/README.md`).
2. **Open the feature.**
   ```bash
   scripts/agent/feature.sh custom-homegate --vendor claude --issue 42 --machine pp2
   ```
   Creates `feat/custom-homegate` as a worktree in a new herdr workspace with three panes (implementer, shell, review), starts the implementer, and asks it for a plan.
3. **Approve the plan.** Read it with `herdr agent read impl-custom-homegate`, answer with `herdr agent prompt`. The agent then implements and runs `pnpm check`.
4. **Simplify and first review.** In the implementer: `/simplify`, then in the review pane `/pubky-review`. Fix Critical and High in the same session.
5. **Cross-vendor review.**
   ```bash
   scripts/agent/review.sh --author claude --pane w3:p3 --machine pp2
   ```
   Runs `pnpm check`, then Codex (and cursor-agent when installed) headless with `.github/prompts/codex-review.md`, writes reports under `.review/<branch>/`, and starts an interactive Claude reviewer in the pane. Read the Verdict lines; open the reports only for Needs changes or Blocked.
6. **PR.** The implementer opens the PR with the template filled in and "Authored by" set. CI runs quality, browser, Security (gitleaks, Semgrep, dependency review), and the Codex review comment. For auth, key, or postMessage changes also run `/code-review ultra` from the laptop.
7. **Merge.** Human reads the review summaries and merges to `dev`. Release PRs from `dev` to `main` run `pnpm check:critical`.

Keep at most three features in flight. Past that, review is the bottleneck and the threat model stops being updated.

## Scheduled audit

`security-audit.yml` runs every Monday 06:00 UTC on `dev`, files one issue per Critical or High finding under the `security-audit` label, and one rollup for the rest. Run it by hand from the Actions tab (`workflow_dispatch`) or locally:

```bash
scripts/agent/audit.sh              # report only, to .review/audit-<date>.md
scripts/agent/audit.sh --file-issues
```

## Guardrails for agents

- `.claude/settings.json` denies reads of `.env.local`, certificates, and credential files, denies edits to workflows and to itself, and runs `scripts/agent/guard-bash.sh` before every Bash command. The hook blocks force pushes, direct pushes to `dev`/`main`, secret changes, and destructive git or filesystem commands.
- Codex and cursor-agent read `AGENTS.md` for the same rules; the Coder workspaces give them no credentials that could push to protected branches.
- CI secrets (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) are only exposed to workflows running on same-repo branches; the Codex review job skips forks and drafts.

## Authorization checklist

| What                       | How                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code in a workspace | Already logged in on `pp1`/`pp2`; new workspaces copy `claude-credentials.json` from `/srv/coder-secrets/agent-auth/` or run `claude login`                         |
| Codex CLI in a workspace   | Copy `~/.codex/auth.json` from the laptop to `/srv/coder-secrets/agent-auth/codex-auth.json` on the devbox, or run `codex login --device-auth` inside the workspace |
| cursor-agent               | `cursor-agent login` on the laptop, then copy `~/.cursor/agent-cli-state.json` to `/srv/coder-secrets/agent-auth/cursor-agent-cli-state.json`                       |
| Codex review in CI         | `gh secret set OPENAI_API_KEY --repo pubky/pubky-passport` (API key from platform.openai.com; billed per token)                                                     |
| Scheduled audit in CI      | `gh secret set ANTHROPIC_API_KEY --repo pubky/pubky-passport` (API key from console.anthropic.com; billed per token)                                                |
| Branch protection          | Repository admin; rulesets are in the repo settings, see `scripts/agent/rulesets.json` for the definition applied                                                   |
