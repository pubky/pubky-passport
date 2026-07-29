# Browser Runtime

Browser-only implementation. Production modules use `client-only` and may import
browser APIs, Google Drive, WebCrypto, and the Pubky SDK.

## Features

- `authorization/` parses the browser entry, presents safe controller state, and
  approves a validated request with the active identity.
- `identity/` owns identity UI orchestration, local Pubky identity custody, provider
  account credential acquisition, and the Google-backed custody/recovery strategy.
- `passport-file/` owns encrypted Passport file storage and browser cryptography.
- `pubky/` owns focused Pubky capability contracts and the concrete SDK adapter.

Within a feature, `application/` contains policy and security-relevant capability contracts,
`adapters/` contains concrete browser or provider integrations, and `composition/`
wires concrete implementations together. Stable UI-facing controllers and their
factories remain at the feature root.

A browser identity setup or restore flow is the only code that may combine a Passport
file envelope with a wrapping key. Drive OAuth access tokens, wrapping keys, and
wrapping key material stay in memory and are never sent to the server.

Browser application modules may depend directly on concrete adapters/classes where
an application-owned port would add no runtime or security capability boundary. Keep
contracts for Pubky key/session/discovery/approval, Passport file crypto/store, local
key custody/catalog, provider authorization, wrapping-key access, and public UI
controllers. Do not add interfaces solely for test fakes.

The local Pubky identity store intentionally persists 32-byte Pubky secret keys in
localStorage as the current accepted custody model. This exposes stored identities
to same-origin XSS, malicious extensions, and shared browser profiles; no other
plaintext key storage is permitted. This is a tradeoff between usability and security that is acceptable for a browser-only implementation.
