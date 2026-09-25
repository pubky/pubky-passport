#!/usr/bin/env bash
# Local equivalent of .github/workflows/security-audit.yml: audit the checkout against the
# threat model with the Claude security auditor and write a report instead of filing issues.
#
#   scripts/agent/audit.sh [--file-issues]
set -euo pipefail
root=$(git rev-parse --show-toplevel); cd "$root"
mkdir -p .review; grep -qx '.review/' .gitignore 2>/dev/null || echo '.review/' >> .gitignore
report=".review/audit-$(date +%Y-%m-%d).md"
if [ "${1:-}" = "--file-issues" ]; then
  claude -p "Follow the instructions in .github/prompts/security-audit.md exactly." \
    --allowedTools "Read,Grep,Glob,Bash(pnpm audit:*),Bash(gh issue list:*),Bash(gh issue create:*),Bash(git log:*),Bash(git diff:*)" \
    --max-turns 80 --output-format text | tee "$report"
else
  claude -p "Follow the instructions in .github/prompts/security-audit.md, but instead of creating GitHub issues, print every finding in the same format to stdout." \
    --allowedTools "Read,Grep,Glob,Bash(pnpm audit:*),Bash(git log:*),Bash(git diff:*)" \
    --max-turns 80 --output-format text | tee "$report"
fi
echo "report: $report"
