# Browser Runtime

Browser-only implementation. Production modules use `client-only` and may import
browser APIs, Google Drive, WebCrypto, and the Pubky SDK.

## Features

- `authorization/` parses the browser entry, presents safe controller state, and
  approves a validated request with the active identity.
- `identity/` owns identity UI orchestration, local custody, Google credential
  acquisition, and Google-backed Pubky identity establishment.
- `passport-file/` owns encrypted Passport-file storage and browser cryptography.
- `pubky/` owns focused Pubky capability contracts and the concrete SDK adapter.

Within a feature, `application/` contains policy and dependency contracts,
`adapters/` contains concrete browser or provider integrations, and `composition/`
wires concrete implementations together. Stable UI-facing controllers and their
factories remain at the feature root.

A browser identity setup or restore flow is the only code that may combine a Drive
envelope with wrapping material. Drive tokens and wrapping material stay in memory
and are never sent to the server.

The local identity store intentionally persists 32-byte Pubky secret keys in
localStorage as the current accepted custody model. This exposes stored identities
to same-origin XSS, malicious extensions, and shared browser profiles; no other
plaintext key storage is permitted. This is a tradeoff between usability and security that is acceptable for a browser-only implementation.
