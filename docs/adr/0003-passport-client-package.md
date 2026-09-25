# 0003. `@pubky/passport-client` npm package

Status: Proposed
Date: 2026-09-25

## Context

App developers integrate Passport by hand today (see `docs/integration.md`). v2 ships a package that opens the popup flow like a Google sign-in button, lets the developer show the auth URL as a QR instead, and lets end users point the package at a different Passport instance, similar to choosing a self-hosted server in a password manager.

## Decision

- The repo becomes a pnpm workspace: `apps/passport` (this Next app) and `packages/passport-client` (framework-agnostic TypeScript, zero runtime dependencies, ESM + types). Existing eslint boundaries move with the app unchanged.
- Public API (initial): `createPassportClient({ instance, appName, capabilities, relay })` returning `signIn({ mode: "popup" | "qr" })`, `onOutcome(cb)`, `setInstance(url)`, `getInstance()`. The package never sees key material; `signIn` resolves with the auth-flow handle from the Pubky SDK the app already holds, or with a plain "completed / cancelled / failed" outcome when the app does not pass an SDK instance.
- Instance origin handling: the developer-provided `instance` is the default. An end-user override is stored under `pubky-passport:instance` in the app origin's `localStorage`, validated with the same rules as ADR 0002, and exposed through `getInstance()` so the app can render a "using custom Passport at X" notice. The package refuses to open a popup whose origin differs from the resolved instance and drops any message whose `event.origin` differs from it.
- The popup outcome is a UI signal. Authentication is always completed by the SDK through the relay (threat model B1, B9). The package README states this in its first paragraph.
- Versioning: semver, changesets, published from `main` by CI with provenance. The app depends on the package through the workspace, so integration tests in `e2e/` cover the real popup path.

## Boundaries touched

B1, B9.

## Consequences

- Moving the app into `apps/` touches every path in CI, Dockerfile, and the Coder template. Do it as a standalone PR with no behaviour change before any package code lands.
- Cursor/Claude/Codex agents need workspace-aware commands; `pnpm -r check` at root, `pnpm --filter passport check` for the app.

## Open questions

- Package name: `@pubky/passport-client` versus `@synonymdev/passport`. Decide with the team before the first publish.
- Should QR mode live in the package (adds a dependency) or stay a rendering concern for the app with the package only exposing the URL? Recommendation: expose the URL only.
