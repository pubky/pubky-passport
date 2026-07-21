# Browser Crypto Adapter

This folder implements Passport-file encryption and decryption with browser
WebCrypto. It derives a non-extractable AES-GCM key from the server-provided
wrapping material and binds the encrypted envelope to the Passport origin.

Wrapping material and decrypted secret-key bytes remain in local memory only. Do
not add browser storage, logging, server requests, or SDK recovery-file handling
here; identity flows and storage code own those separate responsibilities.
