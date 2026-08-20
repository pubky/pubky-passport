# Browser Passport File

Owns the encrypted Passport file format, browser cryptography, and concrete storage
adapters. It does not acquire provider credentials, request wrapping keys, create
Pubky identities, or activate homeserver sessions.

## Modules

- [`passportFileEnvelope.ts`](./passportFileEnvelope.ts) defines and strictly parses
  the v1 envelope.
- [`PassportFileWebCrypto.ts`](./PassportFileWebCrypto.ts) encrypts and decrypts
  32-byte Pubky secret keys.
- [`google/PassportFileStore.ts`](./google/PassportFileStore.ts) owns the authoritative
  `appDataFolder/passport.json` file.
- [`google/VisibleRecoveryCopies.ts`](./google/VisibleRecoveryCopies.ts) owns
  append-only visible copies and detachment cleanup.
- [`google/driveHttp.ts`](./google/driveHttp.ts) contains shared bounded Drive HTTP
  and multipart mechanics.

## Invariants

- Envelope parsing is strict, versioned, and origin-bound.
- Secret and wrapping-key bytes are cleared where JavaScript ownership permits.
- Drive tokens remain operation-scoped and never enter results or persistence.
- The app-data file is authoritative; visible copies are never used for restoration.
- Operational creates reject conflicts instead of overwriting existing files.
- Visible-copy failures do not block activation, but cleanup failures preserve the
  local identity for retry.

`GoogleIdentityOperations` composes these adapters. End-to-end behavior is documented
in [`FLOWS.md`](../../../../FLOWS.md).
