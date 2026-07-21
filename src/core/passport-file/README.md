# Passport File Core

This feature owns the versioned encrypted Drive-file envelope and pure parser.
Browser storage and WebCrypto behavior are identity dependencies because identity
flows consume them; this parser never reads Drive or decrypts ciphertext.
