# Repository Workflow

## PR Size

Every PR must be small and focused. Split large changes before review.

The intended sequence is documented in `docs/planning/mvp-roadmap.md`.

## Before Opening a PR

Run:

```bash
pnpm check
```

Also add manual validation notes to the PR description.

## CI Dependency Audit Policy

CI runs `pnpm audit --prod` after dependency installation. Known-vulnerable production dependencies are release-blocking for Passport because it is a signer app; audit failures must be fixed, upgraded, or explicitly risk-accepted before merge.

GitHub Actions used by CI must be pinned by commit SHA instead of mutable tags. Upgrade pinned actions intentionally by resolving the target release tag to a commit SHA and reviewing the upstream changelog.

## Required Validation By Change Type

### Pure Domain/Application Logic

- Unit tests.
- Typecheck.
- Lint.

### UI Behavior

- Component tests.
- Responsive manual check.
- Screenshot or recording for visual changes.

### Critical Flows

- E2E coverage.
- Manual happy-path and failure-path validation.

### Security-Sensitive Changes

- Explicit threat/risk note.
- Confirm no secrets are logged.
- Confirm no private key material is persisted in plaintext.
- Confirm server/browser/Google data boundaries are preserved.

## AI-Assisted Development

AI-generated code is owned by the author. Review for:

- Hallucinated APIs.
- Wrong Pubky assumptions.
- Unnecessary abstractions.
- Bloated diffs.
- Security regressions.
- Missing tests.
- Boundary violations.

## Local Toolchain

- Node runtime: `22` from `.nvmrc`.
- Package manager: pnpm from `packageManager` in `package.json`.
- If `corepack` is available, run `corepack enable` before installing dependencies.
