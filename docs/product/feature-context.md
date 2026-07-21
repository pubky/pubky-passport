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

Identity establishment is modeled through narrow, independent provider seams rather than one service per provider:

- Browser provider identity covers sign-in and ID-token acquisition.
- Server ID-token verification is represented by the neutral `ProviderIdTokenVerifier` port.
- Encrypted passport storage is represented by the neutral `PassportFileRepository` port.
- Wrapping secret acquisition is separate from provider identity and storage.

Self-custody is not a degenerate provider. It is a future key-custody strategy that will compose neutral ports differently when a setup or restore use case first consumes it.

Google-owned screens are not Passport UI. Passport initiates Google Identity and Drive consent flows but does not recreate account chooser or consent screens.

Server-side Google ID token verification must check:

- Signature.
- Issuer.
- Audience.
- Authorized party when a token has multiple audiences.
- Expiration.
- Subject availability.

Use Google `sub` as the stable user identifier. Do not use email as the stable identity or rate-limit key.

## Wrapping Key API

Route: `/api/wrapping-key`

Purpose:

- Return a Passport-server-derived encryption/wrapping secret only after valid Google ID-token verification.
- Keep the server from ever seeing Google Drive access tokens, encrypted Drive files, decrypted Pubky key material, or browser-local key material.

Identity flow code depends on feature-local contracts. Concrete token verification, secret derivation, and rate limiting belong in server adapters.

Current server derivation contract:

- Derive wrapping material only from canonical verified Google issuer and subject plus `PASSPORT_SERVER_SECRET_BASE64`.
- Do not derive from Google ID token values, Google email, Drive access tokens, encrypted Drive file contents, or Pubky private key material.
- Use HKDF-SHA256 with decoded `PASSPORT_SERVER_SECRET_BASE64` as input key material.
- Use UTF-8 salt `pubky-passport/wrapping-key/salt/v1`.
- Use UTF-8 info `google:<issuer>\n<subject>` with canonical verified issuer and subject values. Google issuer values normalize to `https://accounts.google.com` before derivation.
- The `google:` HKDF info prefix is frozen forever for Google-backed identities because it is baked into every existing user's wrapping key. Future provider prefixes must be added as explicit new constants without changing existing entries.
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
- Concrete `@synonymdev/pubky` key generation, export, import, public key, signup, discovery publication, session, and AuthToken approval APIs are verified below.

Confirmed v1 envelope parser contract:

- The accepted envelope has exactly the top-level fields `v`, `iv`, `ct`, and `url`.
- `v` must be numeric version `1`; other numeric versions are rejected as unsupported.
- Unknown top-level fields are rejected to avoid accidentally accepting plaintext or unrelated metadata.
- `iv` and `ct` must be non-empty base64url-like strings. The parser does not decode, decrypt, or enforce crypto byte lengths; browser crypto owns those checks.
- `url` must be an HTTPS Passport origin with no credentials, query, fragment, or non-root path.
- Accepted `url` values normalize to `URL.origin`, for example `https://passport.pubky.app` with no trailing slash. A root-path form such as `https://passport.pubky.app/` parses to the same origin string.
- HTTP localhost origins are allowed only when an explicit parser option enables local development support.
- Parser errors are safe typed codes with optional field metadata and do not include raw file contents, IV, ciphertext, or future decrypted key material.

Confirmed browser crypto contract for encrypted Drive storage:

- Concrete browser crypto implementation lives in `src/adapters/browser/crypto` behind the identity feature's `PassportFileCrypto` contract.
- The core crypto port encrypts and decrypts 32-byte Pubky secret key material only; the encrypted Drive storage contract does not include SDK metadata.
- The adapter accepts the wrapping key as the 32-byte unpadded base64url string returned by the Passport wrapping-key API.
- Browser crypto decodes wrapping material in browser memory only and derives purpose-specific material with WebCrypto HKDF-SHA256 instead of using the raw wrapping bytes directly as an operational key. The AES-GCM key is derived as a non-extractable WebCrypto `CryptoKey` via `deriveKey` rather than materializing raw AES key bytes in JavaScript.
- Passport file encryption uses AES-256-GCM with a fresh random 96-bit IV per encryption. `iv` and ciphertext `ct` are stored as unpadded base64url strings in the v1 envelope.
- AES-GCM sub-key derivation uses IKM = decoded wrapping material, salt `pubky-passport/passport-file/aes-gcm/salt/v1`, info `passport-file:aes-gcm:v1`, and an AES-256-GCM output key.
- AES-GCM authenticates envelope metadata as additional authenticated data using `pubky-passport/passport-file/v1\n<normalized-envelope-url>`, so tampering with the authenticated v1 context or stored Passport origin fails decryption.
- Decryption also requires the normalized expected Passport origin and rejects an envelope created for a different origin.
- Operational consequence: encrypted files are bound to their Passport origin. A file created by a staging, self-hosted, or other-origin Passport deployment cannot be restored by production Passport without an explicit migration or re-encryption flow. This protects against cross-deployment use even if deployments accidentally share compatible wrapping-key derivation.
- Decryption authenticates ciphertext through AES-GCM and maps authentication failure to a safe typed error without exposing DOMException details.
- Browser crypto must not persist Pubky secret key material, wrapping material, decrypted payloads, or Drive tokens in `localStorage`, `sessionStorage`, IndexedDB, cookies, or server requests.

Confirmed Google Drive appDataFolder repository contract:

- Concrete browser Drive storage lives in `src/adapters/browser/google/drive` behind the identity feature's `PassportFileStore` contract.
- The repository reads and writes encrypted `PassportFileEnvelopeV1` values only. It does not decrypt ciphertext, derive wrapping material, restore Pubky keys, request Homegate invites, import Pubky SDK code, or own Google login and consent UI.
- The repository accepts an injected browser access-token provider and injected `fetch`; Drive access tokens do not appear in core method inputs and are not persisted by the repository.
- Drive lookup uses Google Drive API v3 with `spaces=appDataFolder`, exact `passport.json` name matching, `trashed=false`, and the narrow Drive app data scope expected from future Google consent code.
- A missing Drive file is an expected first-time setup state and returns `missing` rather than an error. If the file is listed but disappears before media fetch, the read also returns `missing`.
- Multiple matching files or pagination evidence are rejected as `duplicate_files` rather than choosing a potentially wrong identity file.
- Reads fetch file content through the Drive media endpoint and parse it with the v1 envelope parser. Malformed file contents map to `invalid_file` without returning raw Drive body, IV, ciphertext, or future decrypted key material.
- Drive list and media response bodies are size-bounded before parsing to avoid unbounded browser memory use.
- Writes revalidate outbound envelopes with the v1 parser before upload, serialize only `v`, `iv`, `ct`, and origin-normalized `url`, create `passport.json` in `appDataFolder` when missing, and update existing file media when exactly one file exists.
- Repository errors are safe typed codes for authorization, permission, network, invalid-response, invalid-file, duplicate-file, and write-failure cases. Raw Google error bodies, access tokens, and envelope contents are not included in errors.
- The repository must not use `localStorage`, `sessionStorage`, IndexedDB, cookies, or server requests for Drive tokens, encrypted envelopes, plaintext recovery bytes, wrapping material, or decrypted payloads.

Confirmed Pubky SDK key-operation APIs:

- Package: `@synonymdev/pubky` version `0.9.3`.
- Concrete SDK imports are limited to `src/adapters/browser/pubky` and test-only verification files.
- `Keypair.random()` creates a new Pubky identity keypair.
- `keypair.publicKey.z32()` returns the z-base-32 public key representation for transport/storage identifiers.
- `keypair.publicKey.toString()` returns the display representation, formatted as `pubky<z32>`.
- `keypair.createRecoveryFile(passphrase)` exports SDK recovery file bytes as `Uint8Array`, but Passport does not use SDK recovery files for MVP Google Drive storage.
- `Keypair.fromRecoveryFile(recoveryFileBytes, passphrase)` restores a keypair from SDK recovery file bytes and the same passphrase, but Passport does not use SDK recovery files for MVP Google Drive storage.
- `keypair.secret()` exports the 32-byte Pubky secret key material used for MVP Google Drive storage.
- `Keypair.fromSecret(secret)` restores a keypair from the same 32-byte secret key material.

Confirmed key material representation for encrypted Drive storage:

- Passport uses 32-byte Pubky secret key material from `keypair.secret()` as the key material representation that is encrypted into the Google Drive `passport.json` envelope.
- Pubky secret key material is sensitive and must stay in browser memory only before Passport envelope encryption.
- Do not store raw Pubky secret key material directly in Google Drive, `localStorage`, logs, or server requests.
- Do not store plaintext SDK keypair material in `localStorage`.
- Do not wrap the Pubky secret in the SDK recovery-file format before Passport encryption; Passport owns encryption through the v1 envelope and server-derived wrapping material.
- A user-added recovery or export mechanism remains a future custody-hardening option that requires separate product, UX, and security review.

Confirmed Pubky SDK signup, discovery, and auth approval APIs:

- `new Pubky()` creates a mainnet SDK facade.
- `Pubky.testnet(host)` creates a local testnet SDK facade.
- `PublicKey.from(value)` parses homeserver public keys for signup and discovery publication.
- `pubky.signer(keypair)` creates a signer from a restored or newly created SDK keypair.
- `signer.signup(homeserverPublicKey, signupTokenOrNull)` signs up to a homeserver and returns a `Session`.
- `signer.signin()` creates a returning-user session and publishes PKDNS in the background according to SDK docs.
- `signer.signinBlocking()` creates a returning-user session and waits for PKDNS publication according to SDK docs.
- `session.info.publicKey`, `session.info.capabilities`, and `session.export()` provide public session metadata; `session.export()` is documented by the SDK as containing no secrets and relying on browser-managed HTTP-only cookies.
- `signer.pkdns.publishHomeserverIfStale(hostOverrideOrNull)` republishes homeserver discovery if the record is missing or stale.
- `signer.pkdns.publishHomeserverForce(hostOverrideOrNull)` forces homeserver discovery publication.
- `signer.approveAuthRequest(pubkyauthUrl)` approves a Pubky auth request; SDK declarations state this encrypts and POSTs the signed AuthToken.

Current signup/auth adapter constraints:

- Passport's browser Pubky adapter accepts explicit `homeserverPubky` and `signupCode` values. It does not call Homegate directly.
- The Homegate server adapter calls `POST /google_verification` and returns `{ signupCode, homeserverPubky }`.
- Deterministic CI tests cover SDK construction, invalid homeserver public key mapping, invalid discovery override mapping, and invalid Pubky auth URL mapping without hitting production Pubky network services.
- Local testnet validation on 2026-06-30 covered signup with a generated homeserver signup token, `publishHomeserverIfStale`, `publishHomeserverForce`, homeserver resolution, `signinBlocking`, `approveAuthRequest`, and third-party `awaitApproval` completion.
- `approveAuthRequest` owns signed AuthToken encryption and HTTP Relay POST behavior for the validated local testnet flow; callback redirect ownership remains a Passport flow responsibility.
- SDK ownership note from local validation: `signer.pkdns.publishHomeserverIfStale/Force(hostOverride)` appears to consume the host override `PublicKey`, so the adapter must not free that `PublicKey` after passing it to those methods.

Core Pubky application ports:

- `PubkyIdentityKeys` covers key creation, 32-byte secret key export, 32-byte secret key restoration, and public identity derivation.
- `PubkySignup` covers homeserver signup with `{ homeserverPubky, signupCode }` and returning-user signin.
- `PubkyDiscovery` covers `publishHomeserverIfStale` and `publishHomeserverForce`.
- `PubkyAuthApproval` covers approval of a validated sensitive Pubky auth request URL.
- These ports do not mention Google, Drive, Homegate HTTP transport, WebCrypto, Next.js, or concrete Pubky SDK types.
- Concrete implementations are not wired into composition yet; wiring belongs with the future setup, restore, and authorization use cases that consume these ports.
- Test fakes live under `test-utils/fakes` and record only non-sensitive metadata such as signup-code presence and auth-request scheme.

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

Passport route:

```http
POST /api/homegate/google-invite
Content-Type: application/json
```

This Passport route accepts only:

```json
{
  "googleIdToken": "<google-id-token>"
}
```

It rejects malformed JSON, missing tokens, empty tokens, non-string tokens, and unknown fields with a fixed `invalid_request` error. Responses include `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

Required boundaries:

- Represent Homegate behind a core port.
- For invite issuance, Homegate is the authoritative Google ID token verifier. Passport validates request shape and forwards only `{ googleIdToken }` to Homegate; Passport does not locally verify the token for this endpoint.
- Homegate verifies the token server-side before issuing an invite.
- Provider-specific Homegate flows own credential validation, request payloads, endpoints, and error mappings. Their successful result is the neutral `HomeserverSignupInvitation` `{ signupCode, homeserverPubky }`; a future setup use case consumes that invitation and never a provider credential.
- Homegate rate-limits by verified Google identity derived from `iss || "\n" || sub`, not email. Passport maps Homegate's weekly and annual limit responses and does not duplicate this persistent invite quota in the initial adapter PR.
- Keep concrete Homegate network calls in server adapters.
- The concrete Passport server adapter reads only `HOMEGATE_URL` for this flow and calls Homegate server-to-server. It does not require or use `PUBKY_HOMESERVER`.
- Unit tests inject `fetch` and do not hit live Homegate.

Confirmed Homegate endpoint contract:

```http
POST /google_verification
Content-Type: application/json
```

Request:

```json
{
  "googleIdToken": "<google-id-token>"
}
```

Successful response:

```json
{
  "signupCode": "<homeserver-signup-code>",
  "homeserverPubky": "<homeserver-public-key>"
}
```

Error responses are plaintext strings:

- `invalid_request`
- `invalid_google_id_token`
- `weekly_limit_exceeded`
- `annual_limit_exceeded`
- `homeserver_unavailable`
- `google_verifier_unavailable`
- `internal_error`

Passport maps Homegate errors to fixed JSON error codes:

- `invalid_request` from Homegate becomes `homegate_invalid_request`.
- `invalid_google_id_token` remains `invalid_google_id_token`.
- `weekly_limit_exceeded` remains `weekly_limit_exceeded`.
- `annual_limit_exceeded` remains `annual_limit_exceeded`.
- `homeserver_unavailable` remains `homeserver_unavailable`.
- `google_verifier_unavailable` remains `google_verifier_unavailable`.
- `internal_error`, network failures, and upstream error-body read failures become `homegate_unavailable`.
- Unknown Homegate error bodies and malformed success JSON become `malformed_homegate_response`.

Passport maps `signupCode` to the existing Pubky signup `signupCode` input and uses Homegate's `homeserverPubky` as the signup homeserver source of truth. Passport should not use `PUBKY_HOMESERVER` as a default or fallback for this flow.

Local Passport Google ID token verification remains required for `/api/wrapping-key`, where Passport derives server-owned wrapping material from verified Google issuer and subject.

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
