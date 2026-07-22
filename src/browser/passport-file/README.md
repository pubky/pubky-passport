# Browser Passport File

Owns encrypted `passport.json` browser adapters. `googleDrivePassportFileRepository`
reads and writes Google Drive app data; `webCryptoPassportFileCrypto` encrypts and
decrypts the file with a non-extractable AES-GCM key.

Keep access tokens, wrapping material, ciphertext, and key bytes local; never put
them in UI state, storage, logs, or server requests.
