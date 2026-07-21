# Browser Identity

Owns Drive storage, Passport-file WebCrypto, and the Pubky SDK behind browser identity
contracts. `googleDrive` reads encrypted `passport.json`; `crypto` encrypts it with a
non-extractable AES-GCM key; `pubky` owns the only SDK imports and in-memory keypairs.

Only this folder may combine Drive data with wrapping material. Keep access tokens,
wrapping material, ciphertext, and key bytes local; never put them in UI state,
storage, logs, or server requests.
