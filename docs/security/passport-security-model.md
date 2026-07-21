# Passport Security Model

## Core split-secret model

Passport security depends on the browser having both:

1. Access to the encrypted key file in Google Drive.
2. A compliant Passport Server handing out the encryption/wrapping secret after Google ID-token verification.

The Passport Server does **not** have the encrypted Drive file.

Google does **not** have the Passport server secret.

Only the Passport browser app has both.

Therefore only the Passport browser app can access the keypair.

## Non-negotiables

The Passport server must never receive:

- Google Drive access token.
- Decrypted Pubky private key.
- Browser-local decrypted key material.

Google must never receive:

- Passport server-derived wrapping/encryption secret.

The browser must not persist plaintext Pubky private key material.

## Sensitive values

Never log:

- Google ID token.
- Google Drive access token.
- Pubky private key material.
- Pubky auth request secret.
- Wrapping/encryption key.
- Raw Google `sub`.
- Full authorization URL.
- Full callback URL with query parameters or fragments.
- `passport.json` ciphertext unless explicitly safe and redacted.

Use `src/libs/logger` for application logging. The logger routes every emitted line through `src/libs/security/redaction.ts` before it reaches the console sink, and lint rules block direct `console.*` calls outside the logger implementation. Redaction is not permission to log secrets; callers should prefer stable event names, typed error codes, boolean validation outcomes, and safe display hosts over raw inputs.

Allowed logging patterns:

- Log route or flow names without raw query strings, such as `authorize.parse.failed`.
- Log typed error codes rather than raw Pubky auth URLs or callback URLs.
- Log callback origin and pathname only after query parameters or fragments are redacted.
- Log token presence as a boolean, never the token value.
- Log keyed hashes for rate-limit identifiers where required, never raw Google `sub` values.

Disallowed logging patterns:

- Raw `/authorize?d=...` URLs.
- Raw `pubkyauth://...` URLs.
- Callback URLs containing query parameters or fragments.
- Google ID tokens, Google Drive access tokens, bearer tokens, wrapping keys, Pubky auth request secrets, or private key material.

## Google ID token verification

Server-side verification must check:

- Signature.
- Issuer.
- Audience.
- Authorized party when a token has multiple audiences.
- Expiration.
- Subject availability.

Use `sub` as the stable Google user identifier.

Do not use email as the stable identity.

For rate limiting, use a keyed hash:

```txt
HMAC-SHA256(secret_pepper, iss || "\n" || sub)
```

## Google Drive

Primary storage:

```txt
Google Drive appDataFolder/passport.json
```

PRD-proposed file:

```json
{
  "v": 1,
  "iv": "...",
  "ct": "...",
  "url": "https://passport.pubky.app"
}
```

Visible recovery backup entry point:

```txt
Google Drive/Pubky Passport/encrypted_key_{app_domain}.json
```

Only encrypted key material may be stored.

See `docs/product/feature-context.md` for feature-level Drive storage behavior.

## Browser key handling

Preferred rule:

- Decrypted key material lives in memory only.
- No raw key material in localStorage.
- Clear decrypted material on logout.
- Clear decrypted material on idle timeout where practical.
- Use WebCrypto non-extractable keys where compatible with Pubky SDK.
- Do not invent alternate key formats without updating `docs/product/feature-context.md` and verifying current Pubky SDK APIs.

## Auth request secret

The `pubkyauth://` request contains a secret.

Risks:

- Query string logs.
- Browser history.
- Analytics.
- Referrers.
- Screenshots.
- Error reports.

Mitigations:

- The MVP baseline supports `/authorize?d=<encoded-pubkyauth-url>` first; future fragment or POST handoff support belongs in a separate transport PR.
- If query parameter is used, add:
  - `Cache-Control: no-store`.
  - `Referrer-Policy: no-referrer`.
  - Strict log redaction.
  - No persistence of raw `d` parameter.
  - Short TTL validation where applicable.

## Callback validation

Allowed:

- HTTPS callbacks.
- Approved mobile app schemes if explicitly configured.

Rejected:

- `javascript:`
- `data:`
- `file:`
- `blob:`
- unapproved custom schemes.
- localhost outside development.

The user-facing app/domain should be derived according to the approved callback rule.

## XSS risk

Passport is a signer.

XSS is critical because injected JavaScript may access signing authority.

Baseline mitigations:

- Strict CSP.
- No unsafe rendering of query parameters.
- No `dangerouslySetInnerHTML` for untrusted content.
- No raw key material in localStorage.
- Dependency review.
- Redacted error reporting.
- Minimal browser storage.

## Detach From Google

A user-held key is superior to Google Login.

Passport must provide a Detach from Google entry point in the MVP surface and implement the key-export or rotation details in a dedicated, reviewed follow-up PR.

Implementation questions for the follow-up PR:

- Does it export encrypted key, raw secret, passphrase backup, or rotate to user-held key?
- What confirmation and warning copy is required?
