# Server Secret Integration

This folder implements operations backed by Passport server secrets. The wrapping
key deriver uses the verified provider issuer and subject with HKDF-SHA256 to return
base64url wrapping material for the browser.

Server secrets, derived wrapping material, tokens, and raw provider identities must
not be logged or returned except through the narrowly scoped wrapping-key route.
This code must never receive Drive files, Drive tokens, or decrypted Pubky
key material.
