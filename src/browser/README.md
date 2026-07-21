# Browser Runtime

Browser-only implementation. Production modules use `client-only` and may import
browser APIs, Google Drive, WebCrypto, and the Pubky SDK.

This runtime owns the split-secret boundary: only `browser/identity` may combine a
Drive envelope with wrapping material. Keep tokens and key bytes in memory; never
persist them or send them to the server. Browser code imports `features`, never
`server` or server environment configuration.
