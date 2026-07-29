# Google Wrapping Key

Creates the deterministic wrapping key used to decrypt a Google-backed
Passport file.

## Flow

1. Verify the Google ID token.
2. Normalize the verified issuer and subject.
3. Rate-limit the verified provider identity.
4. Derive the wrapping key with HKDF.
5. Return only the base64url wrapping key or a safe typed error.

## Files

- `application/googleWrappingKeyRequest.ts`
  Defines the concrete request operation, ordering, and safe errors.

- `adapters/googleIdTokenVerifier.ts`
  Verifies Google signatures and required claims.

- `adapters/inMemoryGoogleWrappingKeyRateLimiter.ts`
  Defines the concrete process-local limiter for an HMAC hash of the verified issuer and subject.

- `adapters/googleWrappingKeyDeriver.ts`
  Defines the concrete deriver implementing the frozen HKDF contract.

- `composition/createConfiguredGoogleWrappingKeyRequest.ts`
  Reads configuration and constructs the concrete request, verifier, limiter, and deriver.
