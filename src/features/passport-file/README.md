# Passport File Feature

This feature owns the versioned encrypted Drive-file envelope and pure parser.
Browser storage and WebCrypto behavior live under `src/browser/identity`; this
parser never reads Drive or decrypts ciphertext.

The parser validates envelope shape and Passport origin normalization without
returning raw malformed contents in errors. Browser crypto code owns byte-length checks,
encryption, decryption, and authentication failure handling.
