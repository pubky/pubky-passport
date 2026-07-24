# Server Runtime

Server-only implementation. Production modules use `server-only` for provider token
verification, server-secret derivation, and rate limiting.

`wrapping-key/google/` contains the complete Google wrapping-key flow: `config.ts`
validates server configuration, `serverSecret.ts` owns secret decoding policy,
`idTokenVerifier.ts` verifies tokens, `keyDeriver.ts` derives frozen HKDF material,
`rateLimiter.ts` limits requests, and `request.ts` coordinates them for the API.

Server flows import `core`, never `browser`, and receive only their required
inputs.
