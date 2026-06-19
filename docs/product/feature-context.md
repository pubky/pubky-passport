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
- Verify concrete `@synonymdev/pubky` key generation, export, import, public key, signup, and AuthToken signing APIs before implementing this feature.

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
