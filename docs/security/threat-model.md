# Pubky Passport threat model

Living document. Every PR that adds, moves, or removes a trust boundary updates the relevant row here in the same PR. Reviewers (human and agent) check changes against this file, not against memory.

Protocol background: [pubky.org/security-model](https://pubky.org/security-model). Shipped versus planned protocol features matter: do not rely on `/priv`, data signing, end-to-end encryption, or mirroring for any security claim.

## Assets

| Asset                                       | Where it lives                          | Impact if lost                                              |
| ------------------------------------------- | --------------------------------------- | ----------------------------------------------------------- |
| Secret key / mnemonic                       | Browser memory, encrypted recovery file | Full identity takeover                                      |
| Recovery-file passphrase and wrapping key   | Browser memory during a flow            | Recovery file becomes readable                              |
| Relay `client_secret` for an auth flow      | Browser memory during one flow          | Attacker completes a sign-in the user started               |
| Server keyring (`PASSPORT_SERVER_SECRET_*`) | Server environment                      | All envelopes issued under that key ID at risk              |
| Session tokens (homeserver, Google)         | Browser storage / cookies               | Impersonation until revoked                                 |
| Instance configuration                      | Server environment                      | Phishing users toward attacker infrastructure               |
| Steward GitHub token                        | Steward workspace only                  | Junk branches and PRs; cannot touch dev, main, or workflows |

## Actors

Homeserver operator (reads, tampers, denies), homegate operator, relay operator, network attacker (MITM, replay), malicious third-party app calling Passport, malicious or compromised Passport instance, cloud-storage provider (Google Drive), DHT attacker, compromised dependency, malicious user of a shared browser.

## Trust boundaries

Each boundary lists the control that must hold. "v2" marks boundaries introduced or changed by the v2 feature set (see `docs/adr/`).

| #   | Boundary                                                | Control                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Third-party app ↔ Passport popup (postMessage)          | Explicit target origin on every send; listener allowlists `event.origin`; outcomes are UI signals only, the app obtains its `Session` through the relay.                                                                                                                                                                                                                                               |
| B2  | Browser ↔ Passport server routes                        | Server routes never receive key material. Server env parsed once by zod. CSP restricts connect origins to configured homeservers and homegate.                                                                                                                                                                                                                                                         |
| B3  | Passport server ↔ Google (wrapping key issuer)          | Server verifies Google ID token; issues wrapping-key material keyed by key ID; keyring never leaves server.                                                                                                                                                                                                                                                                                            |
| B4  | Browser ↔ relay ↔ third-party app                       | Auth URL validated before display (scheme, relay, capabilities, secret). Rejected URL is never edited and reused. Capabilities shown to the user.                                                                                                                                                                                                                                                      |
| B5  | Browser ↔ homeserver (signup, session)                  | Signup tokens validated at the boundary. Session scope and revocation handled deliberately. Known cookie-collision limitation documented in code.                                                                                                                                                                                                                                                      |
| B6  | Browser ↔ homegate (invite, homeserver selection)       | v2. Homegate origin comes from instance config or a user-confirmed custom URL. Homegate response decides which homeserver an invite may unlock; nothing else does.                                                                                                                                                                                                                                     |
| B7  | Instance operator ↔ deployed Passport (feature flags)   | v2. Flags, default homeserver, allowed homegates, Google availability come from server env only. Public subset is server-rendered into the page once. Nothing in a request may override it.                                                                                                                                                                                                            |
| B8  | User-entered URLs (custom homegate/homeserver/instance) | v2. `https:` only, no credentials, no IP literals in production, normalised and displayed before use. Never fetched server-side without an allowlist (SSRF).                                                                                                                                                                                                                                           |
| B9  | Third-party app ↔ `@pubky/passport-client` package      | v2. Package pins the Passport origin it talks to; user override lives in the package's own storage with a visible "custom instance" state; package verifies every message origin.                                                                                                                                                                                                                      |
| B10 | Browser ↔ user's homeserver (profile.json)              | v2. Profile writes go through the SDK adapter with a least-privilege capability; content validated by pubky-app-specs before write.                                                                                                                                                                                                                                                                    |
| B11 | Dependencies and CI                                     | Lockfile frozen; `pnpm audit --prod`; actions pinned to SHAs; secret scanning and Semgrep on every PR; no secrets in workflow logs.                                                                                                                                                                                                                                                                    |
| B12 | Implementer agents ↔ staging repo ↔ steward ↔ GitHub    | Implementers have no GitHub credentials and write only to the shared staging repo and mailbox. The steward alone holds a fine-grained token without the Workflows permission, publishes only `feat/ fix/ chore/` branches, re-runs `pnpm check` itself, and merges to `dev` only when CI and both independent reviews pass. `main` is merged by a human. Branch protection applies to the steward too. |

## Known limitations

- JavaScript cannot zeroise memory. Freeing SDK handles limits exposure but does not guarantee erasure.
- A malicious Passport instance chosen by the user can phish that user. The package (B9) can only make the choice visible, not safe.
- Google as a recovery provider means Google can deny recovery and can see ciphertext. It cannot read key material without the wrapping key.

## Review triggers

A PR must run the security review (`/pubky-review` locally, plus the cross-vendor review in CI) when it touches any of: `src/server/**`, `src/client/logic/authorization/**`, `src/client/logic/pubky/**`, `src/client/logic/homegate/**`, `src/client/logic/wrapping-key/**`, `src/client/logic/passport-file/**`, `postMessage` or `window.opener` usage, CSP or headers, environment parsing, `package.json` dependencies, or any `.github/workflows/*`.
