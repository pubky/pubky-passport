# Browser Runtime

Browser-only implementation. Production modules use `client-only` and may import
browser APIs, Google Drive, WebCrypto, and the Pubky SDK.

`passport-file` owns Drive storage and Passport-file WebCrypto. `pubky` owns concrete
Pubky SDK access and in-memory keypairs. `identity` owns browser-local identity
persistence. A browser setup or restore flow is the only code that may combine a
Drive envelope with wrapping material. Drive tokens and wrapping material stay in
memory and are never sent to the server. The interim local identity store persists
Pubky secret keys in localStorage until passkey-backed encryption is implemented;
its secret-key API is not for UI state. Browser code imports `features`, never
`server` or server environment configuration.
