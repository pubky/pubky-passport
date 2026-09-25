# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

# Pubky Passport: agent guide

Browser signer for `pubkyauth` requests plus cloud-backed identity recovery. Next.js 16 App Router, React 19, strict TypeScript, `@synonymdev/pubky` SDK, `better-result` for errors, Vitest + Testing Library, Playwright end-to-end tests.

Read this file fully before editing. Read `docs/security/threat-model.md` before touching anything listed under "Security invariants". Read the matching ADR in `docs/adr/` before working on a v2 feature.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm dev --experimental-https      # Coder workspaces run this in the tmux session `dev`
pnpm check                         # format:check + lint + typecheck + coverage + build
pnpm test -- <pattern>             # focused unit tests
pnpm test:e2e:run                  # Playwright (needs a prior `pnpm build`)
pnpm check:critical                # audit + check + e2e; run before a release PR
```

`pnpm check` must be green before a PR is opened or a task is reported as done. Report failures verbatim; never skip or weaken a check to make it pass.

## Layout and boundaries

Import boundaries are enforced by `eslint.config.mjs`. Never relax those rules; add an ignore only with an ADR that explains why.

| Path                | Runs in           | May import                                                                 |
| ------------------- | ----------------- | -------------------------------------------------------------------------- |
| `src/app`           | Next routes/pages | `client`, `libs`; no `server/environment` outside approved bootstrap files |
| `src/client/logic`  | browser, no React | `libs`; the SDK only through `src/client/logic/pubky/PubkySdkAdapter.ts`   |
| `src/client/ui`     | browser, React    | `client/logic`, `libs`                                                     |
| `src/server`        | Node runtime      | `libs`; environment only through `src/server/environment.ts`               |
| `src/libs`          | isomorphic        | nothing from `client/` or `server/`                                        |
| `test-utils`, `e2e` | tests             | anything                                                                   |

Conventions:

- Errors cross module boundaries as `better-result` values, never as thrown exceptions. Each domain has its own error union; translate at the boundary, once.
- No `console`; use `src/libs/logger`. Never log key material, tokens, or user-entered URLs at info level.
- Server environment is read and zod-validated once in `src/server/environment.ts`, then passed down as a typed config object. Client code receives public config through a single server-rendered payload, never by reading `process.env`.
- Every `postMessage` names an explicit target origin. Every listener checks `event.origin` against an allowlist derived from server config.
- New logic goes next to its tests: `foo.ts` with `foo.test.ts`. UI gets Testing Library tests; complete flows get an e2e spec.
- Prefer small pure functions in `client/logic` and thin components in `client/ui`. Controllers own state; components render it.

## Security invariants

These are non-negotiable and reviewed on every PR. Details and rationale live in `docs/security/threat-model.md`.

1. Key material (secret keys, mnemonics, recovery passphrases, wrapping keys, relay client secrets) never leaves the browser context that created it, is never logged, never placed in a URL except a designed `#` fragment, never persisted to analytics, and never sent to the Passport server.
2. Only an SDK `Session` authenticates. UI state, postMessage outcomes, callback query parameters, and `xSource` labels are signals, not credentials.
3. Authorization URLs are parsed and validated (scheme, relay, capabilities, secret) before display. The user sees the real callback origin. Capabilities follow least privilege.
4. Server secrets (the keyring) never reach the client. Envelopes carry key IDs only.
5. Instance configuration (feature flags, default homeserver, allowed homegates, Google availability) comes from server environment only. No query parameter, auth URL, cookie, or client storage may change it.
6. User-supplied URLs (custom homegate, custom homeserver, custom Passport instance) are validated (`https:` only, no embedded credentials, no IP literals in production), shown to the user before first use, and never fetched from the server without an allowlist.
7. SDK handles (`Keypair`, `Session`, `AuthFlow`, stores) are freed on every path, including errors and cancellation.
8. No new runtime dependency without a sentence in the PR saying why. `pnpm audit --prod` stays clean.

## How to work

- Branch from `dev`: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`. PRs target `dev`. `main` is release-only.
- One concern per PR. Aim for under 400 changed lines; stack PRs for larger features.
- A change that adds, moves, or removes a trust boundary updates `docs/security/threat-model.md` and the relevant ADR in the same PR.
- Never edit `.env.local`, `certificates/`, or CI secrets. Never `git push --force`. Never push to `dev` or `main` directly. Claude Code hooks in `.claude/settings.json` block these; do not remove the hooks.
- Fill in the PR template honestly, especially "Boundaries touched". It decides which reviews run.
- Reviews are cross-vendor: the agent that wrote a PR does not review it. See `docs/agent-workflow.md`.
- When blocked on a product decision, stop and ask in the PR or issue; do not guess at security-relevant behaviour.

## Definition of done

- `pnpm check` green; `pnpm test:e2e:run` green when a user flow changed.
- Threat model and ADR updated when a boundary changed.
- No `TODO` without an issue link.
- PR description states intent, boundaries touched, and how it was tested.
