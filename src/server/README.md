# Server Runtime

Server-only implementation. Production modules use `server-only` for provider token
verification, server-secret derivation, rate limiting, and Homegate HTTP.

`wrapping-key/google/` contains the complete Google wrapping-key flow:
`idTokenVerifier.ts` verifies tokens, `keyDeriver.ts` derives frozen HKDF material,
`rateLimiter.ts` limits requests, and `request.ts` coordinates them for
`/api/wrapping-key/google`.

Server flows import `features`, never `browser`, and receive only their required
inputs. They must never receive Drive tokens/files, decrypted Pubky keys, or browser
wrapping material.
