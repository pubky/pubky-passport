# Issue #17: Pubky Identity Application Ports And Fake Adapters

Read `AGENTS.md`, `opencode.json`, `docs/product/passport-mvp-brief.md`, `docs/product/feature-context.md`, `docs/architecture/clean-architecture.md`, `docs/architecture/repository-layout.md`, `docs/security/passport-security-model.md`, `docs/engineering/quality-strategy.md`, `docs/engineering/repository-workflow.md`, `docs/pubky/agent-quickref.md`, and the outcomes of issues `#15` and `#16`.

Create a plan for this only: define stable core ports and test fakes that reflect the real SDK adapter behavior confirmed in the prior two slices.

## Goal

Application use cases need testable Pubky identity boundaries for setup, restore, signup, discovery publication, and auth approval without depending on `@synonymdev/pubky`.

This slice should convert the concrete adapter findings into small implementation-agnostic ports and fake adapters for future setup/restore/auth use-case tests.

## Files To Create Or Update

- `src/core/ports/pubkyIdentityKeys.ts`
- `src/core/ports/pubkySignup.ts`
- `src/core/ports/pubkyDiscovery.ts`
- `src/core/ports/pubkyAuthApproval.ts`
- `src/core/domain/identity/publicIdentity.ts` or `src/core/application/identity/publicIdentity.ts`, depending on whether the type has invariants or is application display data.
- `test-utils/fakes/fakePubkyIdentityKeys.ts`
- `test-utils/fakes/fakePubkySignup.ts`
- `test-utils/fakes/fakePubkyDiscovery.ts`
- `test-utils/fakes/fakePubkyAuthApproval.ts`
- `test-utils/architecture/core-boundaries.test.ts` if import rules need strengthening.
- `docs/product/feature-context.md` if final port naming clarifies confirmed SDK behavior.

Exact file names may be consolidated if the confirmed adapter shape is smaller. Prefer fewer files if one cohesive port is enough.

## Do Not Implement

- New SDK API verification beyond gaps found in `#15` and `#16`.
- Google Drive storage.
- Browser crypto.
- Homegate adapter.
- Setup or restore use cases.
- UI integration.
- Production-network tests.
- Plaintext private key persistence utilities.
- Passport file parsing, browser crypto, or Google Drive access. Those belong to issues `#18`, `#19`, and `#20`.
- Any `localStorage` persistence for keypairs, SDK recovery file bytes, wrapping material, or derived passphrases.

## Port Scope

Define only ports required by the confirmed SDK operations:

- Identity key creation.
- Identity key restoration from confirmed encrypted/recovery representation, if supported.
- Public identity derivation/display.
- Homeserver signup using a homeserver public key and invite representation.
- Discovery publication if it is separate from signup/signin.
- Pubky auth approval/signing for a validated sensitive auth request.

Avoid speculative ports for storage, Drive, profiles, public reads, backups, detach flows, or multi-identity management.

## Proposed Type Direction

Use final names based on implementation, but keep these distinctions:

```ts
export type PubkyPublicIdentity = {
  publicKeyZ32: string;
  publicKeyDisplay: string;
};

export type PubkyPrivateKeyHandle = {
  readonly __kind: "pubky_private_key_handle";
};

export type PubkyEncryptedRecoveryMaterial = {
  bytes: Uint8Array;
  format: "pubky-recovery-file";
  sdkVersion: string;
};
```

Important: the recovery material should represent SDK recovery file bytes created by `keypair.createRecoveryFile(passphrase)`. For the Google-only MVP, the passphrase is not user-managed; it is derived in the browser from Passport's server-derived wrapping material with domain separation. The type name should avoid implying the bytes are safe to store directly; Passport still encrypts them into the Google Drive `passport.json` envelope. Optional user-added passphrases should be documented as future custody-hardening work, not modeled into MVP ports unless separately scoped.

## Domain And Application Boundaries

- Core ports import no SDK code.
- Ports do not mention Google, Drive, wrapping keys, Homegate HTTP details, or Next.js.
- Signup ports may accept a `signupCode` and `homeserverPubky` value, but they must not know how Homegate obtains them.
- Public identity display types contain public key/display data only.
- Private key material boundaries are explicit in type names.
- Fakes can simulate private handles but must not contain committed real private keys, seeds, recovery files, tokens, or generated secrets.

## Parser Validation Rules

No parser changes belong in this issue.

Auth approval ports should assume parser/controller code has already validated:

- Scheme is `pubkyauth://`.
- Relay URL is allowed.
- Secret is present but sensitive.
- Capabilities are parsed and reviewable.
- Callback URLs are safe.

The auth approval port should not re-implement callback or relay validation. It may return safe errors for SDK rejection.

## Fake Adapter Behavior

Fakes should support:

- Happy-path identity creation with deterministic public display values.
- Happy-path restoration from test-only ephemeral recovery material.
- Configurable creation, restoration, signup, discovery, and approval failures.
- Recording non-sensitive call metadata for assertions.
- Avoiding storage of raw auth request secrets in public test snapshots where practical.

Do not put generated real Pubky recovery files or private keys in fake fixtures.

## Test Cases

- Core ports compile without importing `@synonymdev/pubky`.
- Fake key port creates deterministic public identity display data.
- Fake key port can simulate restore success and restore failure.
- Fake signup port can simulate accepted invite and rejected invite without exposing invite in errors.
- Fake signup port should use neutral signup terminology, for example `signupCode`, instead of embedding Homegate HTTP concepts.
- Fake discovery port can simulate publication success and failure.
- Fake auth approval port can simulate approval success, cancellation, SDK rejection, and relay/approval failure if those are distinct confirmed outcomes.
- Architecture tests confirm `src/core` import boundaries.

## Risks

- Defining ports before adapter verification can overfit to guessed SDK APIs; therefore this issue should remain after `#15` and `#16` in the stack.
- A single broad `PubkyIdentityPort` may hide too much and make setup tests less precise; several tiny ports may create unnecessary abstraction. Choose the smallest shape that matches the real use cases.
- Public display types must never accidentally include recovery material or private handles.
- Fakes can make unsafe flows look easy if they do not model expected failures like invalid invite, discovery failure, or auth approval rejection.
- Fakes must not normalize unsafe persistence. Do not model plaintext localStorage as a valid key backup path.

## Commands To Run

```bash
pnpm test:run -- src/core test-utils/fakes
pnpm lint
pnpm typecheck
pnpm check
```

## Acceptance Checklist

- [ ] Core ports import no concrete SDK code.
- [ ] Core ports are small and implementation-agnostic.
- [ ] Fake ports can simulate happy paths and expected failures.
- [ ] Public identity types contain public key/display information only.
- [ ] Private key material boundary is explicit in type names.
- [ ] No plaintext private key persistence helpers are added.
- [ ] `pnpm check` passes.
