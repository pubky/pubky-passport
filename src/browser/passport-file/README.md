# Browser Passport File

Owns browser-only encryption and Google Drive storage for the encrypted Passport
file. This feature handles `PassportFileEnvelopeV1` values; it does not acquire
Google credentials, request wrapping keys, create Pubky identities, or activate
homeserver sessions.

The Google-backed identity composition root constructs these adapters and passes
focused, bound operations into the identity use cases.

## Structure

- [`passportFileEnvelope.ts`](./passportFileEnvelope.ts) owns the v1 envelope
  model, strict schema parsing, and Passport-origin normalization.
- [`passportFileWebCrypto.ts`](./passportFileWebCrypto.ts) encrypts and decrypts
  32-byte Pubky secret key material with browser WebCrypto.
- [`googleDrivePassportFileStore.ts`](./googleDrivePassportFileStore.ts) reads,
  creates, and deletes `appDataFolder/passport.json` through Google Drive API v3.

## Crypto Contract

`PassportFileWebCrypto` accepts the wrapping key returned by Passport's wrapping-key
API and derives a non-extractable AES-256-GCM key with HKDF-SHA256. It never uses the
raw wrapping bytes directly as an encryption key.

Encryption:

1. Require exactly 32 bytes of Pubky secret key material.
2. Generate a fresh 96-bit IV.
3. Authenticate the envelope version and normalized Passport origin as additional
   authenticated data.
4. Return only the encrypted v1 envelope `{ v, iv, ct, url }`.

Decryption validates the strict envelope shape, encoded byte lengths, authenticated
metadata, and expected Passport origin before returning 32 secret bytes. Wrapping
key bytes and rejected plaintext are cleared where JavaScript ownership permits.
Failures return safe typed codes and never expose key material, envelope contents,
or browser exception details.

## Google Drive Contract

`GoogleDrivePassportFileStore` receives an injected, short-lived access-token
provider. The token stays inside Drive requests and is never returned in feature
results or persisted by this adapter.

The store:

- Searches only `appDataFolder` for the exact non-trashed name `passport.json`.
- Bounds Drive list, metadata, and media response bodies before parsing.
- Returns `missing` as the expected first-time setup state.
- Rejects duplicate or paginated matches instead of choosing one.
- Revalidates the exact Drive file ID and version after reads.
- Creates only when no file exists and never updates existing media with `PATCH`.
- Uses a named Web Lock when available to serialize same-profile browser-tab
  creates, then re-lists to detect conflicts.
- Deletes only an exact previously verified ID and revision after fresh metadata
  validation; an exact-ID `404` is idempotent success.

Web Locks reduce same-browser races but are not a Drive-side transaction. Concurrent
creates from other profiles, devices, or browsers without Web Locks are reported as
`create_conflict`; the store does not automatically delete either file.

## Security Boundaries

- The encrypted Drive envelope and API-provided wrapping key meet only in browser
  identity orchestration.
- Google Drive receives encrypted envelope data, never a wrapping key or plaintext
  Pubky secret.
- The Passport server receives the Google ID token used for wrapping-key issuance,
  never a Drive OAuth access token, Drive file, or decrypted Pubky secret.
- This feature does not use `localStorage`, `sessionStorage`, IndexedDB, cookies, or
  server requests for Drive tokens, envelopes, wrapping keys, or decrypted payloads.
- Plaintext local identity persistence belongs exclusively to
  [`browser/identity/local`](../identity/local/).
- Logs contain stable operation names and typed error codes only.
