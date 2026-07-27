# Browser Runtime

Browser-only implementation. Production modules use `client-only` and may import
browser APIs, Google Drive, WebCrypto, and the Pubky SDK.

`passport-file` separates Drive storage from Passport-file cryptography while keeping
both under one encrypted-file feature. `pubky/application` exposes focused key,
session-access, discovery, and auth-approval contracts backed by one SDK adapter and
in-memory keypairs.
`identity` owns the safe browser controller,
local identity custody, Google sign-in, Drive access authorization, shared GIS
loading, and the colocated `google-backed-identity` lifecycle feature. A
browser setup or restore flow is the only code that may combine a Drive envelope
with wrapping material. Drive tokens and wrapping material stay in memory and are
never sent to the server.

The local identity store intentionally persists 32-byte Pubky secret keys in
localStorage as the current accepted custody model. This exposes stored identities
to same-origin XSS, malicious extensions, and shared browser profiles; no other
plaintext key storage is permitted.
