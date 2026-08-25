# Google Wrapping Key Server Flow

Server implementation behind
[`POST /api/wrapping-key/google`](../../../app/api/wrapping-key/google/). It verifies
a Google account and derives the wrapping key for that account's Passport file.

## Structure

- [`GoogleWrappingKeyIssuer.ts`](./GoogleWrappingKeyIssuer.ts) owns flow order, safe errors, and configured construction.
- [`GoogleIdTokenVerifier.ts`](./GoogleIdTokenVerifier.ts) verifies the Google token and defines the verified identity contract.
- [`GoogleWrappingKeyDeriver.ts`](./GoogleWrappingKeyDeriver.ts) derives the account key with the frozen HKDF contract.

## Request Flow

1. Verify the Google ID token and normalize its issuer and Google subject.
2. Select the permanent v1 secret or the retained keyring entry named by the public key ID.
3. Use HKDF to derive a deterministic 32-byte wrapping key from that secret and identity.
4. Return the base64url key, its public key ID when applicable, or a safe typed error.

Traffic controls belong at the shared deployment edge. A process-local limiter is
not used because it would give misleading guarantees in multi-instance deployments.
