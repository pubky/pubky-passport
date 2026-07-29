# Google Wrapping Key Server Flow

Server implementation behind
[`POST /api/wrapping-key/google`](../../../app/api/wrapping-key/google/). It verifies
a Google account and derives the wrapping key for that account's Passport file.

## Structure

- [`application/googleWrappingKeyRequest.ts`](./application/googleWrappingKeyRequest.ts) owns flow order and safe errors.
- [`application/googleIdTokenVerification.ts`](./application/googleIdTokenVerification.ts) defines the verified identity contract shared by the flow and adapters.
- [`adapters/googleIdTokenVerifier.ts`](./adapters/googleIdTokenVerifier.ts) verifies the Google token and claims.
- [`adapters/inMemoryGoogleWrappingKeyRateLimiter.ts`](./adapters/inMemoryGoogleWrappingKeyRateLimiter.ts) rate-limits a keyed hash of the verified identity.
- [`adapters/googleWrappingKeyDeriver.ts`](./adapters/googleWrappingKeyDeriver.ts) derives the account key with the frozen HKDF contract.
- [`composition/createConfiguredGoogleWrappingKeyRequest.ts`](./composition/createConfiguredGoogleWrappingKeyRequest.ts) validates configuration and wires the feature.
- [`composition/googleWrappingKeyServerSecret.ts`](./composition/googleWrappingKeyServerSecret.ts) validates and decodes the server secret.

## Request Flow

1. Verify the Google ID token and normalize its issuer and subject.
2. Rate-limit that verified identity.
3. Use HKDF to derive a deterministic 32-byte wrapping key from the server secret and identity.
4. Return the base64url key or a safe typed error.
