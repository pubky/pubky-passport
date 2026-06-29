# Issue #16: Pubky SDK Adapter For Signup And Auth Approval

Read `AGENTS.md`, `opencode.json`, `docs/product/passport-mvp-brief.md`, `docs/product/feature-context.md`, `docs/architecture/clean-architecture.md`, `docs/security/passport-security-model.md`, `docs/engineering/repository-workflow.md`, `docs/pubky/agent-quickref.md`, `docs/vendor/pubky/llms-small.txt`, and the outcome of `01-issue-15-pubky-sdk-key-operations.md`.

Create a plan for this only: extend the concrete browser Pubky infrastructure adapter to compile against real SDK calls for homeserver signup, discovery publication, and Pubky auth approval.

## Goal

Passport needs SDK-backed operations for first-time setup and authorization approval, while application code remains isolated from concrete SDK classes and network behavior.

This slice should compile against the real SDK and document any network/testnet requirements without making CI depend on production Pubky services.

## Files To Create Or Update

- `src/infrastructure/browser/pubky/pubkyIdentityKeyAdapter.ts` or a companion `pubkyIdentityAdapter.ts`
- `src/infrastructure/browser/pubky/pubkyIdentityAdapter.test.ts`
- `src/infrastructure/browser/pubky/sdkSignupAuthVerification.test.ts` if local testnet verification is separate from deterministic unit tests.
- `docs/product/feature-context.md`
- `next.config.mjs` if additional SDK WASM/build configuration is discovered.

Only add `src/core/ports` files in this issue if the adapter shape is already clear enough and issue `#17` will not be the first port-introduction slice.

## Do Not Implement

- Google login.
- Google Drive storage.
- Homegate network adapter.
- Wrapping-key integration.
- Full setup/restore use cases.
- Relay adapter unless the SDK requires an explicit relay handoff outside `approveAuthRequest`.
- Production-network CI tests.
- UI progress screens.
- Passport file parsing, browser crypto, or Google Drive access. Those belong to issues `#18`, `#19`, and `#20`.
- Any `localStorage` persistence for keypairs, SDK recovery file bytes, wrapping material, or derived passphrases.

## Adapter Scope

Extend the Pubky browser infrastructure adapter to verify and expose infrastructure-level methods for:

- Creating a signer from restored or newly created key material.
- Signing up with a homeserver public key and invite if required.
- Establishing a session after signup or signin if the SDK returns a session.
- Publishing required PKDNS/PKARR/discovery records if signup/signin does not handle it.
- Approving a validated Pubky auth request URL through the SDK.

Keep method names implementation-neutral enough that core ports can be small in issue `#17`.

## Homegate Dependency

Homegate Google invite issuance is not implemented yet. This issue should not add a Passport Homegate adapter.

The expected future Homegate endpoint is:

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

Once this exists, Passport should add a separate server adapter that reads `HOMEGATE_URL`, calls `POST /google_verification`, maps `signupCode` to the SDK `signupToken`, maps `homeserverPubky` to the SDK homeserver `PublicKey`, and returns typed Passport results. That follow-up must not log Google ID tokens, raw Google `sub`, invite codes, or sensitive Homegate response bodies.

For this SDK adapter issue, use explicit inputs like `{ homeserverPubky, signupCode }` and keep Homegate transport details out of `src/infrastructure/browser/pubky`.

## Confirmed SDK APIs

Research performed against the npm tarball for `@synonymdev/pubky@0.9.3` confirms these declarations:

```ts
export class Pubky {
  constructor();
  static testnet(host?: string | null): Pubky;
  signer(keypair: Keypair): Signer;
  getHomeserverOf(userPublicKey: PublicKey): Promise<PublicKey | undefined>;
}

export class PublicKey {
  static from(value: string): PublicKey;
  toString(): string;
  z32(): string;
}

export class Signer {
  approveAuthRequest(pubkyauthUrl: string): Promise<void>;
  signin(): Promise<Session>;
  signinBlocking(): Promise<Session>;
  signup(homeserver: PublicKey, signupToken?: string | null): Promise<Session>;
  readonly pkdns: Pkdns;
  readonly publicKey: PublicKey;
}

export class Pkdns {
  publishHomeserverForce(hostOverride?: PublicKey | null): Promise<void>;
  publishHomeserverIfStale(hostOverride?: PublicKey | null): Promise<void>;
}
```

The declaration for `Signer.approveAuthRequest` says it approves a `pubkyauth://` request URL and "encrypts & POSTs the signed AuthToken". That suggests Passport may not need a separate browser relay handoff adapter for approval, but implementation must verify runtime behavior and document the final boundary.

## Expected SDK Verification

Verify runtime behavior against the installed package:

- `new Pubky()` and `Pubky.testnet()` construction.
- `PublicKey.from(homeserverPublicKey)` accepted input formats.
- `pubky.signer(keypair)` accepts the keypair restored by issue `#15`.
- `signer.signup(homeserverPublicKey, inviteOrNull)` parameters and return value.
- `signer.signin()` and `signer.signinBlocking()` behavior and return values.
- `session.info.publicKey`, `session.info.capabilities`, and `session.export()` shape if returned.
- `signer.pkdns.publishHomeserverIfStale()`, `publishHomeserverForce()`, or equivalent discovery APIs.
- `signer.approveAuthRequest(pubkyauthUrl)` return value and whether it performs relay handoff internally.
- Error names or shapes for network failures, invalid homeserver key, invalid invite, and invalid auth request.

## Domain And Application Boundaries

- No concrete Pubky SDK imports in `src/core`.
- Signup and auth approval methods should not accept Google tokens, Drive tokens, wrapping keys, or encrypted Drive payloads.
- Port-facing types should distinguish public identity data from private key handles or recovery material.
- The auth approval API should accept only a validated `pubkyauth://` request representation or a carefully named sensitive URL value produced by the parser/controller layer.
- Do not log the auth request secret, invite code, signed token, SDK session material, or private key material.

## Parser Validation Rules

No parser changes are required unless the SDK requires a different normalized `pubkyauth://` string than the current parser preserves.

If parser output is reused:

- Ensure the full raw auth URL is treated as sensitive.
- Do not persist the raw URL.
- Prefer passing a typed sensitive value into the adapter rather than reconstructing from display-safe fields.
- Keep callback and relay validation in the existing parser/validation layer, not inside the SDK adapter.

## Test Cases

Deterministic tests:

- Adapter maps invalid homeserver public key input to a safe error without exposing invite or key material.
- Adapter maps invalid auth request input to a safe error without logging or returning the raw request.
- Adapter compiles with real SDK method calls.
- Architecture test confirms no SDK imports in `src/core`.

Local testnet or skipped verification tests if feasible:

- Create keypair, signup against local testnet homeserver with accepted invite shape.
- Confirm resulting session public key matches keypair public key.
- Confirm discovery publication call succeeds or is unnecessary after signup/signin.
- Approve a locally generated auth request if testnet relay support is available.

## Risks

- Signup and auth approval likely require network services and cannot be reliable unit tests in CI.
- Invite semantics are Homegate-specific. Current expected shape is `signupCode` from `POST /google_verification`, but error mapping and one-invite policy remain Homegate implementation details.
- The SDK may perform relay handoff inside `approveAuthRequest`, which affects whether Passport needs a separate relay adapter later.
- Browser cookie partitioning can make signin/session behavior work locally but fail under mixed origins.
- Passing raw `pubkyauth://` URLs to the SDK is necessary for approval but security-sensitive; logs and errors must remain redacted.
- Active XSS remains a critical risk while the keypair is in memory for approval. Do not add durable plaintext browser storage as a mitigation or convenience.

## Commands To Run

```bash
pnpm test:run -- src/infrastructure/browser/pubky
pnpm lint
pnpm typecheck
pnpm build
pnpm check
```

Optional local validation if `pubky-testnet` is available:

```bash
pubky-testnet
pnpm test:run -- src/infrastructure/browser/pubky/sdkSignupAuthVerification.test.ts
```

## Acceptance Checklist

- [ ] Signup adapter methods compile against installed SDK APIs.
- [ ] Auth approval adapter methods compile against installed SDK APIs.
- [ ] No concrete Pubky SDK imports exist in `src/core`.
- [ ] CI tests use fakes or deterministic adapter error mapping, not production Pubky network calls.
- [ ] Local testnet validation notes are captured if network behavior cannot run in CI.
- [ ] `docs/product/feature-context.md` records signup, discovery, and auth approval API facts and blockers.
