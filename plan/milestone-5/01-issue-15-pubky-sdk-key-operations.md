# Issue #15: Pubky SDK Adapter For Identity Key Operations

Read `AGENTS.md`, `opencode.json`, `docs/product/passport-mvp-brief.md`, `docs/product/feature-context.md`, `docs/architecture/clean-architecture.md`, `docs/security/passport-security-model.md`, `docs/engineering/repository-workflow.md`, `docs/pubky/agent-quickref.md`, `docs/vendor/pubky/llms-small.txt`, and the installed `@synonymdev/pubky` package typings.

Create a plan for this only: install the newest published `@synonymdev/pubky` version, verify the real Pubky SDK, then implement the smallest browser infrastructure adapter for identity key creation, public key derivation, and supported export/import.

## Goal

Passport needs a real Pubky identity keypair so later Google Drive storage can encrypt the SDK-supported recovery representation instead of a guessed format.

This slice should verify the chosen key custody representation: SDK recovery file bytes from `keypair.createRecoveryFile(passphrase)`, encrypted by Passport into the Google Drive `passport.json` envelope and restored in the browser with `Keypair.fromRecoveryFile(recoveryFileBytes, passphrase)`.

## Files To Create Or Update

- `package.json`
- `pnpm-lock.yaml`
- `next.config.mjs`
- `src/infrastructure/browser/pubky/pubkyIdentityKeyAdapter.ts`
- `src/infrastructure/browser/pubky/pubkyIdentityKeyAdapter.test.ts`
- `src/infrastructure/browser/pubky/sdkKeyVerification.test.ts` if a separate verification spike is clearer than testing only the adapter.
- `test-utils/architecture/core-boundaries.test.ts` or current architecture test location, only if needed to enforce Pubky SDK import boundaries.
- `docs/product/feature-context.md`

## Do Not Implement

- Google Drive storage.
- Browser encryption or wrapping-key use.
- Homeserver signup.
- PKDNS/PKARR publication.
- Pubky auth approval/signing.
- UI flows.
- Application setup or restore orchestration.
- Any plaintext key persistence helper.
- Any `localStorage` persistence for keypairs, SDK recovery file bytes, wrapping material, or derived passphrases.
- Passport file parsing, browser crypto, or Google Drive access. Those belong to issues `#18`, `#19`, and `#20`.

## Adapter Scope

Implement the smallest concrete adapter in `src/infrastructure/browser/pubky` that can:

- Create a new SDK keypair.
- Return public key display information from the created keypair.
- Export key material using the SDK-supported recovery file API.
- Import or restore key material using the SDK-supported recovery file API.

The adapter may temporarily own its own local types if core ports are not yet needed. Add or update core ports only after the SDK shape is verified and stable enough to hide concrete SDK objects.

## Confirmed SDK APIs

Research performed against the npm tarball for `@synonymdev/pubky@0.9.3` confirms these declarations:

```ts
export class Keypair {
  createRecoveryFile(passphrase: string): Uint8Array;
  static fromRecoveryFile(recovery_file: Uint8Array, passphrase: string): Keypair;
  static fromSecret(secret: Uint8Array): Keypair;
  static random(): Keypair;
  secret(): Uint8Array;
  readonly publicKey: PublicKey;
}

export class PublicKey {
  static from(value: string): PublicKey;
  toString(): string;
  toUint8Array(): Uint8Array;
  z32(): string;
}
```

Adapter guidance based on this research:

- Use `Keypair.random()` for identity creation.
- Use `keypair.publicKey.z32()` for transport/storage-safe public identity.
- Use `keypair.publicKey.toString()` for display identity.
- Use `keypair.createRecoveryFile(passphrase)` as Passport's planned SDK-supported export representation.
- Use `Keypair.fromRecoveryFile(recoveryFileBytes, passphrase)` for restoration.
- Do not use `keypair.secret()` or `Keypair.fromSecret()` for MVP Drive storage unless recovery files cannot satisfy the split-secret model and the security docs are updated.
- Treat the recovery-file passphrase input as sensitive. For the Google-only MVP, derive it in the browser from Passport's server-derived wrapping material with domain separation; do not ask the user to manage a separate passphrase.
- Treat returned recovery file bytes as sensitive key material even though the SDK describes them as encrypted with the passphrase; Passport must still place them inside the product-required encrypted Google Drive envelope.
- Document this MVP decision in `docs/product/feature-context.md`. Also document that an optional user-added recovery passphrase is a possible future feature, not part of this adapter slice.

## Expected SDK Verification

Verify runtime behavior against the installed package, not only declarations:

- Whether `Keypair.random()` exists and works in the project test/browser environment.
- Whether `keypair.publicKey` exists.
- Whether public keys expose `z32()` and `toString()`.
- Whether `keypair.createRecoveryFile(passphrase)` returns `Uint8Array` at runtime.
- Whether `Keypair.fromRecoveryFile(recoveryFile, passphrase)` restores the same public key.
- That SDK recovery file bytes can be used as the plaintext input to Passport's own Drive encryption envelope.
- Whether a domain-separated SDK recovery passphrase derived from Passport's wrapping-key material works with `createRecoveryFile` and `fromRecoveryFile` at runtime.
- Whether the SDK classes require explicit `free()` calls in long-running tests or adapters.

## Domain And Application Boundaries

- No concrete Pubky SDK imports in `src/core`.
- No SDK classes in core-facing public types unless the type remains infrastructure-private.
- If a port is introduced in this slice, it should represent operations like `createIdentityKeypair`, `exportIdentityKeyMaterial`, `restoreIdentityKeypair`, and `getPublicIdentity` without exposing `Keypair` or `PublicKey` classes.
- Public identity display types may include `publicKeyZ32` and `publicKeyDisplay`.
- Private or recovery material types must be named explicitly, for example `PubkyRecoveryFileBytes` for the SDK recovery file before Passport applies its Google Drive encryption envelope.

## Parser Validation Rules

No Pubky auth parser changes belong in this issue.

Validation in this slice is limited to SDK key material behavior:

- Reject restore input that is empty or not the expected byte/string representation.
- Return safe typed errors for unsupported export/import rather than throwing raw SDK errors through application boundaries.
- Do not log key material, recovery bytes, passphrases, or raw SDK error data that might contain sensitive values.

## Test Cases

- Creating a keypair returns a non-empty public key z32 string.
- Creating a keypair returns a display string that does not expose private material.
- Recovery-file export/import round trip restores the same public key.
- Malformed recovery bytes or wrong passphrase maps to a safe adapter error.
- Architecture test confirms no `@synonymdev/pubky` imports exist in `src/core`.
- Optional architecture test confirms production imports are limited to `src/infrastructure/browser/pubky`.

## Risks

- The SDK recovery file requires a passphrase. Using a user-managed passphrase would add a third recovery dependency and conflict with the low-friction Google-only MVP, so the planned source is a domain-separated value derived from Passport's server-derived wrapping material.
- A future optional user passphrase could improve custody for advanced users, but it would change recovery UX and failure modes. Do not implement it without a dedicated product/security review.
- Active XSS remains a critical risk for any web signer because in-memory key material can be accessed during an authenticated session. This milestone reduces durable-storage exposure but does not remove active-XSS risk.
- WASM loading may fail in Next.js build or Vitest without `next.config.mjs` and test environment adjustments.
- SDK recovery file bytes may already be encrypted, but product requirements still require Passport-encrypted Google Drive storage; documentation must avoid implying Google Drive stores raw SDK recovery bytes or plaintext private key material.
- A custom key format is out of scope unless SDK recovery files are proven unusable and maintainers explicitly approve an alternative.

## Commands To Run

```bash
pnpm add @synonymdev/pubky@latest
pnpm test:run -- src/infrastructure/browser/pubky
pnpm lint
pnpm typecheck
pnpm build
pnpm check
```

## Acceptance Checklist

- [ ] The newest published `@synonymdev/pubky` version is installed and lockfile updated.
- [ ] Pubky SDK imports are confined to allowed infrastructure or test-only files.
- [ ] Adapter compiles in the Next.js app.
- [ ] Keypair creation and public key derivation are covered by a focused test or verification.
- [ ] Recovery-file export/import round trip is covered.
- [ ] Wrong passphrase or malformed recovery bytes map to safe errors.
- [ ] `docs/product/feature-context.md` records exact SDK version and SDK recovery file bytes as the key material representation encrypted into Drive.
- [ ] `docs/product/feature-context.md` records that the MVP SDK recovery passphrase is derived from Passport wrapping material and that user-added passphrases are deferred future work.
