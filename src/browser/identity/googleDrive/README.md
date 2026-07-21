# Google Drive Passport File Storage

This adapter reads and writes the encrypted `passport.json` envelope in Google
Drive's `appDataFolder`. It validates envelope format with the pure Passport-file
parser but never decrypts ciphertext or imports the Pubky SDK.

The adapter receives an access-token provider and `fetch` through its constructor.
It must not own Google account UI, wrapping-key requests, Homegate calls, or browser
persistence. A missing file represents first-time setup; duplicate files are an
explicit safe error rather than an arbitrary identity choice.
