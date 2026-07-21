# Browser Runtime

This folder contains browser-only Passport feature implementation. Every production
module starts with `import "client-only"` and may use browser APIs, Google Drive
access tokens, WebCrypto, and the Pubky browser SDK.

Browser identity code is the only concrete code allowed to combine encrypted Drive
data with wrapping material and process decrypted identity material. Keep those
values in local memory, avoid browser persistence, and never send them or Drive
tokens to Passport server routes. Browser flows import pure rules from
`src/features`, but never import `src/server` or server environment configuration.
