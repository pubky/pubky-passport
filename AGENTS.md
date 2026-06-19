# Pubky Passport Agent Instructions

## Product

This repository builds **Pubky Passport**.

Passport is a standalone web app intended to run at:

```txt
https://passport.pubky.app
```

The first MVP is **Login with Google only**.

Do not implement broader Passport signer features unless a tracked issue explicitly requests them.

## MVP scope

MVP includes:

- Standalone Passport web app.
- `/authorize` flow that accepts a Pubky auth deep link.
- Google login.
- Google Drive encrypted key storage.
- First-time Pubky identity creation.
- Returning-user Pubky identity restoration.
- Homegate invite retrieval using a valid Google ID token.
- Homeserver signup.
- Required Pubky discovery / PKDNS / PKARR publication steps.
- Capability review before signing.
- Pubky AuthToken signing.
- HTTP Relay handoff.
- Success/cancel/error callback handling.
- Basic regular Passport app surface for identity status, manual auth paste, backup entry point, and Detach from Google entry point.
- Recovery / backup / Detach from Google planning hooks, with implementation details captured in small follow-up PRs.

## Explicit non-goals for first MVP

Do not build unless a tracked issue explicitly scopes it:

- QR-code login.
- Full Pubky Ring replacement.
- Login with own key as primary onboarding.
- Non-Google identity providers.
- Native mobile app.
- Passphrase import as the main flow.
- Unscoped web signer behavior.

## Required context files

Before planning or coding, read:

- `docs/product/passport-mvp-brief.md`
- `docs/product/feature-context.md`
- `docs/product/mockups-analysis.md`
- `docs/architecture/clean-architecture.md`
- `docs/architecture/repository-layout.md`
- `docs/security/passport-security-model.md`
- `docs/engineering/quality-strategy.md`
- `docs/engineering/repository-workflow.md`
- `docs/pubky/agent-quickref.md`

For Pubky protocol or SDK details:

1. Read `docs/vendor/pubky/llms-small.txt` first.
2. Search `docs/vendor/pubky/llms-full.txt` only for specific API/protocol details.
3. Do not invent Pubky SDK APIs.

If the vendor Pubky docs are missing, ask to run:

```bash
./scripts/fetch-pubky-docs.sh
```

## Clean architecture rule

Dependency direction must point inward:

```txt
Next.js app routes / UI
  -> controllers
    -> application use cases
      -> domain models + ports
        -> infrastructure adapters
```

Hard rules:

- `src/core/domain` must be pure TypeScript.
- `src/core/application` may depend on domain and ports only.
- `src/core` must not import Next.js.
- `src/core` must not import React.
- `src/core` must not import Google SDKs.
- `src/core` must not import Pubky SDK concrete adapters.
- `src/core` must not import browser globals such as `window`, `document`, or `localStorage`.
- External systems must be represented as ports in `src/core/ports`.
- Concrete implementations belong in `src/infrastructure`.
- Next.js `app/` files must stay thin.

## Security rules

Never log or persist plaintext:

- Pubky private key material.
- Google ID tokens.
- Google Drive access tokens.
- Pubky auth request secret.
- Wrapping/encryption key.
- Full authorization URLs.
- Callback URLs with query parameters.
- Passport ciphertext unless explicitly safe and redacted.

The Passport server must never receive:

- Google Drive access token.
- Decrypted Pubky private key material.
- Browser-local decrypted key material.

Google must never receive:

- Passport server-derived wrapping/encryption secret.

The browser is the only place where both of these meet:

1. The encrypted Drive file.
2. The Passport-server-provided encryption secret.

## Decided bootstrap context

- Product target: standalone Passport web app at `https://passport.pubky.app`.
- MVP provider: Google only.
- Primary storage: encrypted Pubky key material in Google Drive `appDataFolder/passport.json`.
- Split-secret model: the browser is the only place where the encrypted Drive file and Passport-server-derived wrapping secret meet.
- Authorization transport baseline: support `/authorize?d=<encoded-pubkyauth-url>` with strict no-store/no-referrer/redaction mitigations.
- Implementation order: parser first, then static authorization UI, then server wrapping-key API, then Pubky SDK key-material spike, then Drive storage and setup/restore flows.
- SDK facts must be verified against `docs/vendor/pubky/llms-small.txt`, `docs/vendor/pubky/llms-full.txt`, and current package APIs before using concrete Pubky calls.
- Feature-specific implementation context lives in `docs/product/feature-context.md`; keep it updated when a feature slice ships.

## Workflow

Before coding a non-trivial change:

1. Read relevant docs.
2. Produce a short plan.
3. Identify affected layers.
4. Identify tests and manual validation.
5. Keep the PR small.
6. Do not combine unrelated work.

## Validation

After scaffold exists, use:

```bash
pnpm check
```

For UI work, also run the relevant component or E2E tests and include manual validation notes.

## AI accountability

AI-generated code is owned by the author.

Review for:

- Hallucinated APIs.
- Wrong Pubky assumptions.
- Unnecessary abstractions.
- Bloated diffs.
- Security regressions.
- Missing tests.
- Boundary violations.
