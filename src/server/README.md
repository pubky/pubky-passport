# Server Runtime

Server-only implementation. Production modules use `server-only` for provider token
verification, server-secret derivation, and rate limiting.

`config/googleClientId.ts` owns the shared browser/server Google audience, while
`config/browserBootstrapConfig.ts` validates the Homegate URL that server entry
points deliberately pass to browser components and CSP.

`wrapping-key/google/` contains the complete Google wrapping-key flow. Its
`application/` folder owns orchestration and feature-local contracts, `adapters/`
owns Google verification, HKDF derivation, secret decoding, and rate limiting, and
`composition/` validates runtime configuration and wires the API dependency graph.

Server flows import `core`, never `browser`, and receive only their required
inputs. Layered server features point inward from composition and adapters to
application contracts; small server mechanisms do not require empty role folders.
