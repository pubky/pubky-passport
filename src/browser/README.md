# Browser Runtime

Browser-only implementation. Production modules use `client-only` and may import
browser APIs, Google Drive, WebCrypto, and the Pubky SDK.

`passport-file` owns Drive storage and Passport-file WebCrypto. `pubky` owns concrete
Pubky SDK access and in-memory keypairs. A browser setup or restore flow is the only
code that may combine a Drive envelope with wrapping material. Keep tokens and key
bytes in memory; never persist them or send them to the server. Browser code imports
`features`, never `server` or server environment configuration.
