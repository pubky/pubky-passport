# Milestone 5: Pubky SDK Identity Adapter Stack

Read `AGENTS.md`, `opencode.json`, `docs/product/passport-mvp-brief.md`, `docs/product/feature-context.md`, `docs/product/mockups-analysis.md`, `docs/architecture/clean-architecture.md`, `docs/architecture/repository-layout.md`, `docs/security/passport-security-model.md`, `docs/engineering/quality-strategy.md`, `docs/engineering/repository-workflow.md`, `docs/pubky/agent-quickref.md`, and `docs/vendor/pubky/llms-small.txt` before implementation.

Use this milestone folder to plan the stacked implementation for issues `#15`, `#16`, and `#17`. These issues belong together because the concrete `@synonymdev/pubky` API shape should drive the core ports and fakes, not the other way around.

## Stack Order

1. `01-issue-15-pubky-sdk-key-operations.md`
2. `02-issue-16-pubky-sdk-signup-auth-approval.md`
3. `03-issue-17-pubky-identity-ports-and-fakes.md`

Supporting review note:

- `security-review-notes.md`

## Branch Strategy

- Stack these from the previous branch and keep each commit or sub-branch linear.
- Merge the stack as one PR into `main` if review agrees the key-operation, signup/auth, and port/fake work should land atomically.
- Keep implementation commits separable by issue so review can still inspect the SDK verification slice before the application port slice.
- Do not start Google Drive storage, encryption, setup orchestration, or UI integration in this milestone.

## Current Repository Facts

- `@synonymdev/pubky` is not currently listed in `package.json`.
- There are no existing `src/infrastructure/browser/pubky` adapter files.
- Current `src/core/ports` only contains wrapping-key and Google ID-token related ports.
- `next.config.mjs` does not yet include the Pubky SDK WASM/Turbopack workaround referenced by the Pubky stack guidance.

## Related Deferred Issues

Do not implement these in milestone 5, but keep the contracts compatible with them:

- Issue `#18`: pure `passport.json` parser and envelope validation under `src/core/pipes/passport-file`.
- Issue `#19`: browser WebCrypto encryption/decryption adapter under `src/infrastructure/browser/crypto`.
- Issue `#20`: Google Drive `appDataFolder` repository under browser infrastructure.

Milestone 5 only verifies and represents SDK recovery file bytes. Parser, crypto, and Drive access belong to `#18`, `#19`, and `#20`.

## Diagram-Derived Flow Context

The PRD diagram establishes the intended wrapping-secret flow:

- Browser receives Google `id_token` and Google Drive `access_token` from Google OAuth.
- Browser sends only the Google `id_token` to Passport Server.
- Passport Server verifies the Google token and audience.
- Passport Server derives and returns wrapping material.
- Browser uses Drive access to find encrypted `passport.json` in Google Drive `appDataFolder`.
- Browser combines wrapping material and encrypted Drive file locally.
- Passport Server never receives Drive access tokens, encrypted Drive files, SDK recovery file bytes, decrypted key material, or browser-local key material.

Current repository security docs refine the derivation input: use verified Google `iss` and `sub`, not unverified raw token claims.

## Local Storage Decision

The PRD's weakness section mentions plaintext keypair storage in `localStorage`. This repo intentionally improves that design.

Milestone 5 and follow-up storage/crypto work should follow these stricter rules:

- No plaintext Pubky keypair in `localStorage`.
- No raw SDK recovery file bytes in `localStorage`.
- No wrapping material or derived SDK recovery passphrase in `localStorage`.
- Decrypted key material and SDK keypair handles live in browser memory only.
- Durable storage is the Passport-encrypted `passport.json` envelope in Google Drive.

See `security-review-notes.md` for the PR-ready security rationale and review checklist.

## Confirmed SDK Research

The Pubky stack reference and AI kit guidance include examples around `@synonymdev/pubky@0.6.0`, but this milestone should use the newest published npm version at implementation time. As of this planning update, npm reports `@synonymdev/pubky@0.9.3`.

Research performed against the npm tarball for `@synonymdev/pubky@0.9.3` confirms these TypeScript declarations in `pubky.d.ts`:

- `Keypair.random()` for keypair creation.
- `keypair.publicKey` for public key derivation.
- `publicKey.z32()` for stable z-base-32 representation.
- `publicKey.toString()` for display form, likely `pubky<z32>`.
- `keypair.createRecoveryFile(passphrase): Uint8Array` for encrypted recovery-file export.
- `Keypair.fromRecoveryFile(recoveryFile: Uint8Array, passphrase: string): Keypair` for recovery-file import.
- `Keypair.fromSecret(secret: Uint8Array): Keypair` and `keypair.secret(): Uint8Array` exist, but Passport should avoid using raw secret export/import for Drive storage unless recovery files are unusable and the security model is explicitly revisited.
- `new Pubky()` and `Pubky.testnet()` for SDK construction.
- `pubky.signer(keypair)` for signer creation.
- `PublicKey.from(value: string): PublicKey` for homeserver/user public key parsing.
- `signer.signup(homeserver: PublicKey, signupToken?: string | null): Promise<Session>` for homeserver signup.
- `signer.signin(): Promise<Session>` publishes PKDNS in the background.
- `signer.signinBlocking(): Promise<Session>` waits for PKDNS publication.
- `signer.pkdns.publishHomeserverIfStale(hostOverride?: PublicKey | null): Promise<void>` for discovery publication.
- `signer.pkdns.publishHomeserverForce(hostOverride?: PublicKey | null): Promise<void>` for forced discovery publication.
- `signer.approveAuthRequest(pubkyauthUrl: string): Promise<void>` approves a `pubkyauth://` request and, per declarations, encrypts and POSTs the signed AuthToken.
- SDK errors use `PubkyErrorName`: `"RequestError" | "InvalidInput" | "AuthenticationError" | "PkarrError" | "ClientStateError" | "InternalError"`.

Implementation must still verify runtime behavior in this repository's Next.js/Vitest environment before treating these declarations as complete.

## Documentation Updates Required

Update `docs/product/feature-context.md` during implementation with:

- Exact installed `@synonymdev/pubky` version.
- Exact import names used from the SDK.
- Confirmed key material representation that Passport will encrypt before storing in Google Drive: SDK recovery file bytes from `keypair.createRecoveryFile(passphrase)`.
- Export/import support through `keypair.createRecoveryFile(passphrase)` and `Keypair.fromRecoveryFile(recoveryFileBytes, passphrase)`.
- Export/import requires an SDK recovery passphrase. For the Google-only MVP, do not ask the user to store a third secret. Derive the SDK recovery passphrase in the browser from Passport's server-derived wrapping material with domain separation.
- Passport encrypts SDK recovery file bytes into the Google Drive `passport.json` envelope. Drive must store Passport-encrypted material, not raw SDK recovery bytes or plaintext private key material.
- Signup API parameters, including homeserver public key format and invite shape.
- Whether signup publishes required PKDNS/PKARR records or whether Passport must call a separate SDK API.
- Auth approval API result shape and whether relay handoff is fully handled by the SDK or still requires a separate Passport relay adapter.
- Any blockers that prevent Google Drive storage work from proceeding.
- Future-feature note: users may optionally add their own recovery passphrase later, but that is not part of the Google-only MVP and needs separate UX, recovery, and security design.

## Homegate Dependency

Homegate does not yet expose the Google-based invite endpoint needed by Passport. This milestone should not implement the Passport Homegate adapter until Homegate lands its endpoint.

Expected Homegate endpoint from the upstream Homegate issue:

```http
POST /google_verification
Content-Type: application/json
```

Request:

```json
{
  "googleIdToken": "..."
}
```

Success response:

```json
{
  "signupCode": "...",
  "homeserverPubky": "..."
}
```

Homegate is responsible for:

- Verifying the Google ID token server-side against Google JWKS.
- Checking `aud` against configured Google client ID.
- Accepting only `accounts.google.com` or `https://accounts.google.com` issuer.
- Requiring non-expired token and non-empty `sub`.
- Building stable identity preimage from verified `iss + "\n" + sub`.
- Hashing the identity before storage/rate limiting using Homegate's existing `HasherArgon2id`.
- Not storing or logging raw Google ID tokens or raw Google `sub`.
- Generating a homeserver signup token only after verification and rate-limit checks pass.
- Returning `signupCode` and `homeserverPubky`.

Passport follow-up adapter shape after Homegate exists:

- Read `HOMEGATE_URL` from server env.
- Call `POST /google_verification` server-to-server.
- Send only `{ googleIdToken }` in the request body.
- Map `signupCode` to the Pubky SDK `signupToken` argument.
- Map `homeserverPubky` through `PublicKey.from(...)` in the Pubky SDK adapter path.
- Map Homegate failures to Passport typed results without logging Google ID tokens, raw Google subjects, invite codes, or raw response bodies that may contain sensitive data.

Known Homegate open questions that may affect Passport adapter mapping:

- Whether errors follow existing Homegate plaintext response conventions or JSON error codes.
- Whether one invite per Google identity forever is enforced with a unique index.
- Whether config accepts one `google_client_id` or multiple accepted client IDs.

## Architecture Boundaries

- `@synonymdev/pubky` may only be imported from `src/infrastructure/browser/pubky` or test-only SDK verification files.
- `src/core` must not import the Pubky SDK, React, Next.js, browser globals, or environment modules.
- Core ports should be minimal and implementation-agnostic.
- Pubky ports must not mention Google, Drive, wrapping keys, or Passport storage.
- Public identity display types must contain public material only.
- Private key material must be represented explicitly and must never be used as UI display state.

## Validation Commands

Run after implementation:

```bash
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
pnpm check
```

Run focused tests while developing once file names exist:

```bash
pnpm test:run -- src/infrastructure/browser/pubky
pnpm test:run -- src/core/ports test-utils/fakes
```

## Clarifications Needed

- Confirm the newest published `@synonymdev/pubky` version at implementation time and record the resolved version in `docs/product/feature-context.md`.
- Use SDK recovery file bytes as the key representation Passport encrypts into Drive, unless runtime verification proves the SDK API unusable in Passport's browser environment.
- Confirm the exact browser derivation helper for the SDK recovery passphrase from Passport's server-derived wrapping material. Use a domain-separated derivation instead of reusing the same bytes directly for both SDK recovery and Drive envelope encryption.
- Track Homegate endpoint completion. Passport expects `POST /google_verification` to return `{ signupCode, homeserverPubky }`, but error shape remains open until Homegate implementation lands.
- Should auth approval return only a success/failure result, or should the adapter expose a signed token/session artifact if the SDK returns one?
- Issue `#16` says to use APIs from the adapter added in Issue 14, but the key adapter appears to be issue `#15`; confirm whether this is a numbering typo.

## Improvements To Consider Before Coding

- Add an architecture test assertion that blocks `@synonymdev/pubky` imports outside `src/infrastructure/browser/pubky` and explicitly allowed test verification files.
- Add a focused SDK verification test file that can be skipped or isolated if WASM cannot run in CI, while still keeping `pnpm check` deterministic.
- Keep adapter methods coarse enough to hide SDK classes from core, but not so broad that one method performs Google Drive, encryption, signup, discovery, and auth approval together.
- Prefer documenting unsupported SDK recovery behavior early instead of inventing a custom key format.
- Document the MVP passphrase decision clearly: SDK recovery passphrase is derived from Passport wrapping material, not user-managed. A user-added passphrase can be considered later as an advanced custody option.
