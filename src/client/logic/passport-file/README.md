# Browser Passport File

Owns browser-only encryption and Google Drive storage for the encrypted Passport
file. This feature handles `PassportFileEnvelopeV1` values; it does not acquire
Google credentials, request wrapping keys, create Pubky identities, or activate
homeserver sessions.

The Google-backed identity operations construct these adapters directly and keep
their credentials and encrypted file values inside the browser flow.

## Structure

- [`passportFileEnvelope.ts`](./passportFileEnvelope.ts) owns the v1 envelope
  model, strict schema parsing, and Passport-origin normalization.
- [`PassportFileWebCrypto.ts`](./PassportFileWebCrypto.ts) encrypts and decrypts
  32-byte Pubky secret key material with browser WebCrypto.
- [`google/PassportFileStore.ts`](./google/PassportFileStore.ts) owns operational
  `appDataFolder/passport.json` reads, creation, and deletion.
- [`google/VisibleRecoveryCopies.ts`](./google/VisibleRecoveryCopies.ts) owns
  append-only visible-copy creation and exhaustive detachment cleanup.
- [`google/driveHttp.ts`](./google/driveHttp.ts) contains only shared bounded Drive
  HTTP, response parsing, and multipart mechanics.

## Crypto Contract

`PassportFileWebCrypto` accepts the wrapping key returned by Passport's wrapping-key
API and derives a non-extractable AES-256-GCM key with HKDF-SHA256.

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

`GoogleDrivePassportFileStore` and `GoogleDriveVisibleRecoveryCopies` receive a
short-lived Drive access token and injected `fetch` directly. Instances are
operation-scoped; the token stays inside Drive requests and is never returned in
feature results or persisted by either adapter.

The store:

- Searches only `appDataFolder` for operational reads of the exact non-trashed name
  `passport.json`.
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

## Visible Recovery Copy

After `GoogleDrivePassportFileStore` creates `appDataFolder/passport.json`,
`GoogleIdentityOperations` asks `GoogleDriveVisibleRecoveryCopies` to write
the encrypted envelope to:

```txt
Google Drive/Pubky Passport/{pubky}.json
```

This copy exists only so the user retains a recovery artifact if Google removes
Passport's app-data access. `appDataFolder/passport.json` remains the sole file used
by identity setup, restore, authorization, and synchronization. Normal Passport
consumers must not read or update the visible copy; restoring a user-selected copy
requires a separate future flow.

The browser requests Google's narrow `drive.file` scope in addition to the required
`drive.appdata` scope. A returned grant without optional `drive.file` is still usable
for operational restore; the visible-copy adapter then returns an unconfirmed outcome
without blocking activation. Detachment requires `drive.file` so Passport can remove
the recovery artifacts it created. `GoogleDriveVisibleRecoveryCopies` creates the
`Pubky Passport` folder when needed and writes only files created by Passport. Visible recovery copies are append-only.
Repeated writes intentionally create additional same-name Drive files; no existing
file is updated or overwritten. Each new copy is verified by its exact returned Drive
file ID, revision, parent folder, and trashed state.

The app-data write completes first. If the secondary visible write cannot be
confirmed, identity activation continues and reports a safe warning so a transient
backup failure cannot strand an unsigned-up operational identity. The creation use
case applies one short deadline to the entire visible-copy attempt and aborts its
Drive requests when that deadline expires. Visible file writes need no filename lock
because repeated same-name files are intentional. Folder creation remains
non-atomic across tabs, profiles, and devices; ambiguous duplicate folders produce an
unconfirmed outcome without deleting either recovery artifact.

Detachment first binds the newly authorized Google account to the account stored on
the local identity. It then verifies `appDataFolder/passport.json` against the selected
Pubky when that file exists, deletes every exact `{pubky}.json` match in every
accessible root `Pubky Passport` folder, deletes the verified app-data file, and only
then clears the local identity. Any Drive cleanup failure keeps the local identity so
the user can retry. A missing app-data file is allowed because the account binding
still prevents deleting another Google account's visible recovery copies.

Restore from the visible recovery copy is not implemented yet.
