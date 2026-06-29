# Pubky Passport Feature Context

This file captures implementation context for the MVP features. It is not a speculative design log. If a feature is not listed here or in `docs/product/passport-mvp-brief.md`, do not add it without a tracked issue.

## Authorize Entry Point

Route: `/authorize`

MVP input:

- `/authorize?d=<encoded-pubkyauth-url>`.
- The decoded URL must use the `pubkyauth://` scheme.
- The request includes relay, secret, capabilities, and success/cancel/error callback information.

Required behavior:

- Parse and validate the request before showing authorization UI.
- Never persist the raw `d` parameter or decoded authorization URL.
- Treat the Pubky auth request secret as sensitive.
- Derive a safe requesting-app display name from validated callback/relay context.
- Add no-store and no-referrer mitigations when the route behavior is implemented.

Do not implement QR-code login, fragment transport, or POST handoff in the parser PR.

## Capability Review

Users must see requested capabilities before Passport signs anything.

Display each capability with:

- Path.
- Read permission.
- Write permission.
- Trust or scope warning when the request is broad.

Signing must remain blocked until the user explicitly confirms.

## Google Login

MVP provider: Google only.

Google-owned screens are not Passport UI. Passport initiates Google Identity and Drive consent flows but does not recreate account chooser or consent screens.

Server-side Google ID token verification must check:

- Signature.
- Issuer.
- Audience.
- Expiration.
- Subject availability.

Use Google `sub` as the stable user identifier. Do not use email as the stable identity or rate-limit key.

## Wrapping Key API

Route: `/api/wrapping-key`

Purpose:

- Return a Passport-server-derived encryption/wrapping secret only after valid Google ID-token verification.
- Keep the server from ever seeing Google Drive access tokens, encrypted Drive files, decrypted Pubky key material, or browser-local key material.

Application logic must depend on ports. Concrete token verification, secret derivation, and rate limiting belong in server infrastructure adapters.

Current server derivation contract:

- Derive wrapping material only from verified Google issuer and subject plus `PASSPORT_SERVER_SECRET_BASE64`.
- Do not derive from Google ID token values, Google email, Drive access tokens, encrypted Drive file contents, or Pubky private key material.
- Use HKDF-SHA256 with decoded `PASSPORT_SERVER_SECRET_BASE64` as input key material.
- Use UTF-8 salt `pubky-passport/wrapping-key/salt/v1`.
- Use UTF-8 info `google:<issuer>\n<subject>` with exact verified issuer and subject values.
- Return 32 derived bytes encoded as base64url; browser crypto adapters decode this string before use.

## Google Drive Passport Storage

Primary storage:

```txt
Google Drive appDataFolder/passport.json
```

MVP file envelope:

```json
{
  "v": 1,
  "iv": "...",
  "ct": "...",
  "url": "https://passport.pubky.app"
}
```

Rules:

- Store encrypted key material only.
- Do not send the Drive access token to the Passport server.
- Do not send the encrypted Drive file to the Passport server.
- Do not persist plaintext Pubky private key material.
- Concrete `@synonymdev/pubky` key generation, export, import, and public key APIs are verified below. Signup, discovery publication, and AuthToken approval APIs remain for the focused signup/auth adapter slice.

Confirmed Pubky SDK key-operation APIs:

- Package: `@synonymdev/pubky` version `0.9.3`.
- Concrete SDK imports are limited to `src/infrastructure/browser/pubky` and test-only verification files.
- `Keypair.random()` creates a new Pubky identity keypair.
- `keypair.publicKey.z32()` returns the z-base-32 public key representation for transport/storage identifiers.
- `keypair.publicKey.toString()` returns the display representation, formatted as `pubky<z32>`.
- `keypair.createRecoveryFile(passphrase)` exports SDK recovery file bytes as `Uint8Array`.
- `Keypair.fromRecoveryFile(recoveryFileBytes, passphrase)` restores a keypair from SDK recovery file bytes and the same passphrase.
- `keypair.secret()` and `Keypair.fromSecret(secret)` exist in the SDK, but Passport does not use raw secret export/import for MVP Google Drive storage.

Confirmed key material representation for encrypted Drive storage:

- Passport uses SDK recovery file bytes from `keypair.createRecoveryFile(passphrase)` as the key material representation that will be encrypted into the Google Drive `passport.json` envelope.
- SDK recovery file bytes are sensitive and must stay in browser memory only before Passport envelope encryption.
- Do not store raw SDK recovery file bytes directly in Google Drive, `localStorage`, logs, or server requests.
- Do not store plaintext SDK keypair material in `localStorage`.
- For the Google-only MVP, the SDK recovery passphrase is not user-managed. It will be derived in the browser from Passport server-derived wrapping material with domain separation in the browser crypto slice.
- A user-added recovery passphrase remains a future custody-hardening option that requires separate product, UX, and security review.

Visible backup/export is an MVP surface entry point, but the actual backup/export mechanism belongs in a small follow-up PR.

## Identity Setup

First-time Google user flow:

1. Generate or create the real Pubky key material using verified Pubky SDK APIs.
2. Encrypt and store the key file in Google Drive `appDataFolder`.
3. Retrieve a Homegate invite using a valid Google ID token.
4. Sign up to the configured homeserver.
5. Publish required Pubky discovery, PKDNS, or PKARR records according to verified SDK behavior.
6. Show setup progress and success state.

The UI should reflect the PRD progress steps: store encrypted key, sign up to homeserver, publish PKDNS records, activate identity.

## Identity Restore

Returning Google user flow:

1. Read encrypted `passport.json` from Google Drive `appDataFolder` in the browser.
2. Request the wrapping secret from Passport server after Google ID-token verification.
3. Decrypt key material in browser memory only.
4. Restore the real Pubky identity using verified SDK APIs.
5. Show identity confirmation before authorization.

The browser is the only place where encrypted Drive file and Passport-server-derived wrapping secret meet.

## Homegate Invite

Passport needs a Homegate invite for homeserver signup.

Required boundaries:

- Represent Homegate behind a core port.
- Verify Google ID tokens server-side before invite issuance or proxying.
- Rate-limit by keyed hash of `iss || "\n" || sub`, not email.
- Keep concrete Homegate network calls in infrastructure.

The exact Homegate endpoint contract should be confirmed in the implementation PR before coding the adapter.

## Relay Handoff And Callbacks

After approval, Passport signs the Pubky AuthToken with the restored or newly created Pubky key, posts the encrypted token to HTTP Relay, and redirects to the validated callback.

Rules:

- Never log full callback URLs with query parameters.
- Reject unsafe callback schemes such as `javascript:`, `data:`, `file:`, and `blob:`.
- Allow HTTPS callbacks.
- Allow localhost only in development.
- Allow custom mobile schemes only if explicitly configured.

## Regular Passport App Surface

MVP surface includes:

- Identity status/home card.
- Manual `pubkyauth://` paste entry point.
- Backup/export entry point.
- Detach from Google entry point.
- Settings entry point.

Backup/export and Detach from Google must be implemented in focused follow-up PRs because they affect key custody and recovery.
