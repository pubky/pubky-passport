# Server Runtime

Server-only implementation. Production modules use `server-only` for provider token
verification, server-secret derivation, rate limiting, and Homegate HTTP.

`wrapping-key/` contains the complete Google wrapping-key flow: `googleIdTokenVerifier.ts`
verifies tokens, `wrappingKeyDeriver.ts` derives frozen HKDF material,
`wrappingKeyRateLimiter.ts` limits requests, and `requestGoogleWrappingKey.ts`
coordinates them.

Server flows import `features`, never `browser`, and receive only their required
inputs. They must never receive Drive tokens/files, decrypted Pubky keys, or browser
wrapping material.
