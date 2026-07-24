# Browser Runtime

Browser-only implementation. Production modules use `client-only` and may import
browser APIs, Google Drive, WebCrypto, and the Pubky SDK.

`passport-file` owns Drive storage and Passport-file WebCrypto. `pubky` owns concrete
Pubky SDK access and in-memory keypairs. `identity` owns the safe browser controller,
local identity custody, Google sign-in, Drive access authorization, shared GIS
loading, and the colocated `google-backed-identity` lifecycle feature. A
browser setup or restore flow is the only code that may combine a Drive envelope
with wrapping material. Drive tokens and wrapping material stay in memory and are
never sent to the server. The interim local identity store persists
Pubky secret keys in localStorage until passkey-backed encryption is implemented;
its key-store API is separate from the catalog-only controller API and is never
available to UI state. Browser code imports `core`, never
`server` or server environment configuration.
