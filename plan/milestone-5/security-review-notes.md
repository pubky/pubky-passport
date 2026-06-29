# Security Review Notes: Pubky Passport Key Custody

Audience: cryptography and security review for the implementation stack covering issues `#15`, `#16`, and `#17`, plus compatibility with follow-up issues `#18`, `#19`, and `#20`.

## Purpose

The PRD describes the right split-secret direction, but it also mentions a weaker localStorage model in the XSS weakness discussion. The implementation plan intentionally tightens that design before key handling code is written.

This note explains the planned custody model, how it differs from the PRD text, and what a reviewer should sign off on before Drive crypto and storage are implemented.

## PRD Baseline

The PRD's core security model says the browser must be the only place that can combine:

- Access to the encrypted Google Drive file.
- A compliant Passport Server returning an encryption secret after Google verification.

The PRD diagram shows:

- Browser gets Google `id_token` and Drive `access_token` from Google OAuth.
- Browser sends `id_token` to Passport Server.
- Passport Server verifies token and audience.
- Passport Server derives `encryption_secret`.
- Browser reads encrypted `passport.json` from Drive `appDataFolder`.
- Browser decrypts locally.

That split-secret model is preserved.

## Intentional Improvements Over PRD

### No Plaintext Keypair In localStorage

The PRD weakness section says the browser will store the user's keypair in localStorage. The implementation plan rejects that as an MVP design.

Planned behavior:

- Do not persist plaintext Pubky private key material in `localStorage`.
- Do not persist SDK `Keypair` secrets in `localStorage`.
- Do not persist SDK recovery file bytes in `localStorage`.
- Do not persist wrapping material, Drive envelope keys, or SDK recovery passphrases in `localStorage`.
- Keep decrypted key material in memory only for the active browser session.

Reason:

- `localStorage` is available to any injected JavaScript in the Passport origin.
- Passport is a signer, so XSS impact is critical.
- Removing durable plaintext browser storage lowers the value of one-time XSS, browser extension access, and accidental debug exposure.

Residual risk:

- Any active XSS while the user is signed in can still access in-memory signing authority.
- This is inherent for a web signer and must be mitigated separately with CSP, strict input handling, no unsafe rendering, dependency review, and minimal browser storage.

### SDK Recovery File Bytes As The Key Representation

Research against `@synonymdev/pubky@0.9.3` confirms:

```ts
keypair.createRecoveryFile(passphrase): Uint8Array
Keypair.fromRecoveryFile(recoveryFileBytes, passphrase): Keypair
```

Planned behavior:

- Use SDK recovery file bytes as the key material representation Passport encrypts into Drive.
- Treat SDK recovery file bytes as sensitive even though the SDK encrypts them with a passphrase.
- Do not use raw `keypair.secret()` for MVP Drive storage.

Reason:

- SDK recovery files are a supported SDK import/export format.
- Raw secret export would create a stronger plaintext handling burden.
- Using the SDK's recovery representation improves forward compatibility with SDK expectations.

### No User-Managed Passphrase In Google-Only MVP

The SDK recovery file API requires a passphrase. Adding a user-managed passphrase would require three recovery dependencies:

- Google account and Drive access.
- Passport Server wrapping material.
- User's separate passphrase.

Planned behavior:

- Do not ask the user to manage a recovery passphrase in the Google-only MVP.
- Derive the SDK recovery passphrase in the browser from Passport server-derived wrapping material with domain separation.
- Document optional user-added passphrase as a future custody-hardening feature.

Reason:

- The MVP goal is low-friction Google onboarding.
- A third user-managed secret would increase account loss risk and onboarding friction.
- Future advanced custody options can add a user passphrase after UX and recovery semantics are designed.

### Domain-Separated Derived Secrets

Do not reuse the exact same bytes for every cryptographic role.

Planned direction for issue `#19`:

```txt
server wrapping material
  -> derive "pubky-passport/sdk-recovery-passphrase/v1"
  -> SDK recovery-file passphrase

server wrapping material
  -> derive "pubky-passport/drive-envelope-key/v1"
  -> WebCrypto Drive envelope key
```

The exact browser derivation helper belongs to issue `#19`, not milestone 5.

Reason:

- Domain separation avoids cross-protocol key reuse.
- The SDK recovery passphrase and Drive envelope key have different consumers and failure modes.

### Server Derivation Uses Verified Claims

The PRD diagram labels derivation with `id_token.sub`. Current repo docs improve this requirement.

Planned behavior:

- Passport Server verifies the Google ID token first.
- Derive wrapping material only from verified issuer and subject plus server secret.
- Use verified `iss` and `sub`, not untrusted raw JWT fields.

Current documented contract:

```txt
HKDF-SHA256
input key material: decoded PASSPORT_SERVER_SECRET_BASE64
salt: pubky-passport/wrapping-key/salt/v1
info: google:<issuer>\n<subject>
output: 32 bytes, base64url encoded
```

Reason:

- Prevents client-supplied raw `sub` strings from becoming identity proof.
- Keeps email out of stable identity and rate-limit keys.

## Planned Data Flow

First-time user:

1. Browser obtains Google `id_token` and Drive `access_token` from Google.
2. Browser sends `id_token` to Passport Server wrapping-key endpoint.
3. Passport Server verifies token and returns wrapping material.
4. Browser derives an SDK recovery passphrase and Drive envelope key from wrapping material using separate domain labels.
5. Browser creates Pubky SDK keypair.
6. Browser exports SDK recovery file bytes with the derived SDK recovery passphrase.
7. Browser encrypts those recovery file bytes into the `passport.json` envelope.
8. Browser writes encrypted `passport.json` to Drive.
9. Browser keeps the SDK keypair in memory for setup/signup/auth work.

Returning user:

1. Browser obtains fresh Google `id_token` and Drive `access_token`.
2. Browser sends `id_token` to Passport Server wrapping-key endpoint.
3. Passport Server verifies token and returns wrapping material.
4. Browser reads encrypted `passport.json` from Drive.
5. Browser decrypts the Drive envelope locally.
6. Browser obtains SDK recovery file bytes in memory.
7. Browser derives SDK recovery passphrase from wrapping material.
8. Browser restores SDK keypair with `Keypair.fromRecoveryFile(recoveryFileBytes, passphrase)`.
9. Browser keeps restored keypair in memory for auth work.

## Invariants To Preserve

- Passport Server never receives Google Drive access tokens.
- Passport Server never receives encrypted Drive file contents.
- Passport Server never receives SDK recovery file bytes.
- Passport Server never receives decrypted Pubky private key material.
- Google never receives Passport server-derived wrapping material.
- Google Drive stores only Passport-encrypted `passport.json` envelopes.
- Browser durable storage never contains plaintext keypair material.
- Browser durable storage never contains raw SDK recovery file bytes.
- SDK imports stay outside `src/core`.
- Google, Drive, crypto, and Pubky SDK adapters stay outside core application logic.

## What This Proves And What It Does Not

This design proves by data-flow separation that neither Google nor Passport Server alone can restore the Pubky keypair:

- Google has Drive file access but not Passport wrapping material.
- Passport Server can derive wrapping material after Google token verification but does not have Drive file access.
- Only the browser session that has both Google Drive access and Passport wrapping material can decrypt and restore the keypair.

This design also improves the PRD's localStorage risk by ensuring that browser persistence does not contain plaintext key material or SDK recovery file bytes.

This design does not prove safety against active malicious JavaScript running in the Passport origin while the user is authenticated. A web signer must still assume active XSS can access in-memory signing authority. That residual risk needs CSP, strict parsing, redaction, dependency hygiene, no unsafe rendering, and follow-up hardening such as WebCrypto non-extractable key delegation where compatible with the SDK.

## Deferred To Later Issues

- Issue `#18`: parse and validate outer `passport.json` envelope `{ v, iv, ct, url }` without crypto or Drive access.
- Issue `#19`: implement exact WebCrypto algorithm, IV size, encoding, AAD, and domain-separated browser derivations.
- Issue `#20`: implement Google Drive `appDataFolder` read/write for encrypted envelopes only.
- Homegate follow-up: call server-to-server `POST /google_verification` after Homegate implements it.
- Future custody feature: optional user-added recovery passphrase with separate UX, recovery, and security review.

## Review Questions For Sign-Off

- Is deriving the SDK recovery passphrase from Passport wrapping material acceptable for the Google-only MVP?
- Are the proposed domain labels sufficient for separating SDK recovery passphrase derivation from Drive envelope key derivation?
- Should SDK recovery file bytes be considered acceptable plaintext input to Passport envelope encryption?
- Should the Drive envelope encryption use `url` and `v` as associated data?
- Is memory-only keypair handling acceptable for MVP despite active-XSS residual risk?
- Should visible Drive backup copy be implemented together with appDataFolder storage or deferred as a separate backup/export feature?

## PR Summary Language

This PR intentionally tightens the PRD's browser storage model. The PRD mentions localStorage as a weakness; Passport will not store plaintext keypairs, SDK recovery bytes, wrapping material, or derived passphrases in localStorage. The only durable browser-accessible key backup is the Passport-encrypted `passport.json` envelope in Google Drive. The browser restores the keypair only after combining Drive access with Passport server-derived wrapping material, preserving the split-secret model while reducing persistent XSS exposure.
