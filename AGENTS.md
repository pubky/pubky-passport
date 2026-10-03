<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Pubky Passport: agent guide

Pubky Passport is a web signer for Pubky `pubkyauth` requests, the browser counterpart of Pubky Ring. It keeps identities in the browser (added with Google, created through Homegate or an invite code, or imported from a backup), connects Ring-held identities, and edits their `pubky.app` profiles. Stack: Next.js 16 App Router, React 19, strict TypeScript, `@synonymdev/pubky` 0.12.0, `pubky-app-specs` 0.7.0, `better-result`, zod, Vitest with Testing Library, Playwright. User-facing behaviour and configuration live in `README.md`, `docs/integration.md`, `docs/signer-behavior.md` and `docs/signup-integration.md`, and the package's in `packages/passport-client/README.md`; keep them true when behaviour changes.

## Protocol knowledge

Pubky SDK, pubkyauth, app-specs and homeserver facts come from the pubky agent skills ([pubky/agent-skills](https://github.com/pubky/agent-skills): `pubky`, plus `pubky-mobile` for Ring deeplinks) and the installed types in `node_modules/@synonymdev/pubky/pubky.d.ts`, never from memory. Before touching auth, storage or profile code, read the matching reference (`auth.md`, `sdk-js.md`, `app-specs.md`, `shipped-vs-planned.md`) and use only documented behaviour. The app installs SDK 0.12.0, which the skills describe; `packages/passport-client` builds and tests against 0.11.0 and accepts `>=0.11.0 <0.13.0`, so in each workspace the installed `pubky.d.ts` wins where the two differ. Say so when a behaviour has not been verified against a real homeserver or the Ring app.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm dev --experimental-https  # https://localhost:3000, configured by .env.local (see .env.example)
pnpm check                     # format:check + lint + typecheck + test:coverage + build
pnpm test:run <filter>         # focused unit tests; `pnpm test` watches
pnpm --filter @pubky/passport-client test # package unit tests
pnpm format                    # prettier --write .
pnpm test:e2e                  # build, then Playwright; `pnpm test:e2e:run` reuses the last build
pnpm check:critical            # audit --prod + check + e2e; run before a release PR
```

Playwright starts its own servers on `PASSPORT_E2E_PORT` (default 3100) and the port after it; pick a free port when runs share a machine. Report failures verbatim; never skip, weaken or delete a check to make it pass.

## Layout and boundaries

`eslint.config.mjs` enforces these imports, except that for the root `src/*.ts` files it bans only the SDK and `pubky-app-specs`; never relax a rule to make code fit. Tests, `test-utils/` and `e2e/` may import anything.

| Path                                     | Runs in                     | May import                                                                                                                                                                                                        |
| ---------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app`                                | routes and pages            | `client`, `server`, `libs`; only `layout.tsx` imports `server/environment`                                                                                                                                        |
| `src/proxy.ts`, `src/instrumentation.ts` | server bootstrap            | `libs`, `server/environment` (the proxy builds the CSP per request)                                                                                                                                               |
| `src/instrumentation-client.ts`          | browser, before hydration   | `client/logic`, `libs`; never `server`                                                                                                                                                                            |
| `src/client/logic`                       | browser, no React           | `client/logic`, `libs`; never `server` or `src/instrumentation-client.ts`                                                                                                                                         |
| `src/client/ui`                          | browser, React              | `client/logic`, `libs`; never `server`                                                                                                                                                                            |
| `src/server`                             | Node                        | `libs`; `environment.ts` only from `wrapping-key/google/GoogleWrappingKeyIssuer.ts`                                                                                                                               |
| `src/libs`                               | isomorphic                  | nothing from `client`, `server`, the SDK or `pubky-app-specs`                                                                                                                                                     |
| `packages/passport-client/src`           | browser, framework-agnostic | no app imports; SDK values only in `flow/pubkyFlowAdapter.ts`; `pubky-app-specs` only in `profile/validateProfile.ts`; no React; package-local result unions instead of `better-result` (no runtime dependencies) |
| `examples/*`                             | demo apps                   | public package entry points only                                                                                                                                                                                  |

- The SDK is imported only in `src/client/logic/pubky/PubkySdkAdapter.ts`, and `pubky-app-specs` (WASM, loaded with `import()`) only in `src/client/logic/profile/ProfileSpecsAdapter.ts`. Callers get plain data and `better-result` values, not SDK objects. Modules a page renders on its first paint reach the adapter only through `import()`, so the 2.6 MB SDK chunk never delays that paint; `e2e/browser-behavior.spec.ts` checks it.
- `src/client/logic` domains: `authorization` (request parsing, approval, outcome handoff, the leave guard and presence signal for a pending request), `pubky` (SDK adapter, PKARR republish, invite lookup), `profile` (profile read and write, Ring profile grant), `homegate` (SMS and Lightning invites), `local-account` (Passport-held account setup and drafts), `local-identity` (the identity catalog and each identity's last-read profile summary), `backup` (recovery-file import and check, and the Pubky Ring backup check), `google-identity`, `passport-file` and `wrapping-key` (Google Drive recovery), `signup`, `universal-signer` (screen routing and the Pubky Ring deep-link hand-off).

## Conventions

- Errors cross module boundaries as `better-result` values (`CodedFailure<Code>` from `src/libs/result.ts`), never as thrown exceptions. Each domain has its own error-code union; translate at the boundary, once.
- No `console`; use `LOGGER` from `src/libs/logger/logger.ts`. Never log key material, tokens, invite codes or user-entered URLs; redaction is defence in depth only.
- The server environment is read and zod-validated once in `src/server/environment.ts`. The client receives public configuration from the root layout, never by reading `process.env`.
- Controllers in `client/logic` own state and side effects; components in `client/ui` stay thin and render that state through hooks.
- Tests sit next to the code (`foo.ts` with `foo.test.ts`); UI gets Testing Library tests, complete flows an `e2e/` spec. Prefer constructor injection and `test-utils/` fakes over `vi.mock` of internal modules.
- Copy is provider-neutral: an instance has no provider name, and no text names one.

## Security invariants

Non-negotiable; reviewed on every PR.

1. Key material (secret keys, recovery passphrases, relay secrets) never leaves the browser except through a designed handoff (the request fragment, Passport's own Ring grant link and QR, which a press on the QR also copies to the clipboard, the Ring migration QR, which is never copied, encrypted recovery files and Drive copies), is never logged and never reaches the Passport server. In Passport's `https:` URLs it appears only in a `#` fragment, never in a query or path; the `pubkyauth://` and `pubkyring://` deeplinks carry it as the protocol defines. Wrapping keys from the server stay in memory.
2. Browser-held secret keys and unfinished-setup drafts are plaintext in `localStorage` today, readable by any script on the origin; the SDK keeps delegated grant keys, non-extractable, in IndexedDB. One request is persisted, by design: while it is at Google in the same window (Continue with Google during a request, only when the browser blocked Google's pop-up), the validated request with its relay secret, the OAuth state and nonce and the operation to continue wait in the tab's `sessionStorage` (`pubky-passport/google-redirect/v1`) for at most five minutes, are read once on return and removed, and are dropped by any request that enters at `/authorize`; Google's tokens are never stored. The script policy (nonce plus `'strict-dynamic'`, no third-party scripts) is part of key protection; do not loosen it or persist secrets anywhere new without a maintainer decision.
3. Only an SDK `Session` authenticates. UI state, `postMessage` outcomes, callback parameters and `x-source` labels are signals, not credentials. Every `postMessage` names an explicit target origin; every listener checks `event.source` and `event.origin`.
4. Requests enter only at `/authorize#d=<request>` (with an optional `profile=required` next to `d=`); `/#d=` is forwarded there (v1 contract), and `/authorize` without a request hands over to `/` before app code runs. `/#profile=<key>` on `/` is not a request: it carries a public key only, is scrubbed before hydration, opens that key's profile setup and grants nothing. One request may come back on `/`: the one that left for Google in this window because the browser blocked Google's pop-up (Google returns to the origin root). It is revalidated from the saved record, serves only to finish that Google sign-in, is never listed, reviewed or approved there, and returns to `/authorize#d=<request>` for its review. Requests are validated (kind, relay, capabilities, secret, callbacks) before display, the user sees the real requester, and Passport never replaces a client's request.
5. Capabilities follow least privilege. Passport's own Ring profile grant is write-only for `/pub/pubky.app/profile.json`, `files/` and `blobs/` (the check after approval requires the same list) and lasts for the page session. Its backup check (the Pubky Ring card on Verify your backup) asks for no capabilities, counts only an approval signed with the identity's own key, writes nothing and signs its Session out as soon as that key is read. Disposing the connection signs the session out and must also clear the SDK's delegated keys from IndexedDB (`browserSessionStore.clearAll()`) without breaking a grant in another tab. Revoking on page leave is best effort only: the revocation started on page hide is dropped on unload and closing the tab sends nothing, so the grant stays valid on the homeserver, and write-only acceptance by Ring and the homeserver is not device-tested yet.
6. The signer pages (`/`, `/authorize`) may connect to any `https:` origin, because homeservers come from PKARR records and relays from requests. `img-src` stays narrow (`'self' data: blob:` and Google avatars; profile images are SDK reads shown as `blob:`), legal pages and the 404 keep the narrow connect list, and only the signer pages may use the camera.
7. Any homeserver the user has an invite for is allowed on every instance, and an identity always uses the homeserver its PKARR record names. There is no default homeserver: `PUBKY_SIGNUP_HOMESERVER` is optional, and code must handle it being unset.
8. Instance configuration (Google, signup methods, signup homeserver, Homegate, relay, links) comes only from the server environment; no query parameter, request, cookie or client storage changes it. Server secrets never reach the client; envelopes carry key IDs only.
9. User input is validated before use: a URL Passport fetches or loads (avatars, homeservers, relays) is `https:` without credentials, homeservers are pubky public keys, invite codes have the token form. The server never fetches a user-supplied URL. Published profile links are neither fetched nor loaded, so they take any address the pubky-app-specs profile validation accepts; only `http:` and `https:` links without credentials are rendered as links (new tab, `rel="noopener noreferrer"`), and every other scheme is shown as plain text.
10. SDK handles (`Keypair`, `Session`, `AuthFlow`, stores) are freed on every path, including errors and cancellation.

## How to work

- Branch from `dev` and open PRs against `dev`; `main` only receives releases from `dev`.
- One concern per PR, small enough to review (aim for under 400 changed lines). Split larger work into stacked PRs, each based on the previous branch and green on its own.
- Never commit secrets, `.env.local` or `certificates/`; never force-push a shared branch or push to `dev` or `main` directly.
- A change to a security invariant, the CSP or an environment variable updates this file, `README.md`, `.env.example` and the docs in the same PR.
- When a product or security decision is open, stop and ask in the PR or issue; do not guess.

## Definition of done

- `pnpm check` green, and the affected Playwright specs green (at least `chromium` and `mobile-chromium`, plus `invite-only` when the change touches instance configuration or invite flows) when a user flow changed.
- New logic has tests next to it; docs and `.env.example` match the behaviour.
- No `TODO` without an issue link; no new runtime dependency without a reason in the PR, and `pnpm audit --prod` stays clean.
- The PR description states intent, security-relevant changes and how it was tested.
