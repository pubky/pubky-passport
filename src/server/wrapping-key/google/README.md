# Google Wrapping Key Server Flow

Server implementation behind
[`POST /api/wrapping-key/google`](../../../app/api/wrapping-key/google/). It verifies
a Google account and derives the wrapping key for that account's Passport file.

## Structure

- [`GoogleWrappingKeyIssuer.ts`](./GoogleWrappingKeyIssuer.ts) owns flow order, safe errors, and configured construction.
- [`googleIdTokenVerification.ts`](./googleIdTokenVerification.ts) defines the verified identity contract shared by the flow and dependencies.
- [`GoogleIdTokenVerifier.ts`](./GoogleIdTokenVerifier.ts) verifies the Google token and claims.
- [`InMemoryGoogleWrappingKeyRateLimiter.ts`](./InMemoryGoogleWrappingKeyRateLimiter.ts) rate-limits a keyed hash of the verified identity.
- [`GoogleWrappingKeyDeriver.ts`](./GoogleWrappingKeyDeriver.ts) derives the account key with the frozen HKDF contract.

## Request Flow

1. Verify the Google ID token and normalize its issuer and Google subject.
2. Rate-limit that verified identity.
3. Use HKDF to derive a deterministic 32-byte wrapping key from the server secret and identity.
4. Return the base64url key or a safe typed error.
