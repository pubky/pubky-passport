# Google Wrapping Key Client

Browser client for [`POST /api/wrapping-key/google`](../../app/api/wrapping-key/google/).
It exchanges a Google ID token for the deterministic 32-byte wrapping key used by
the identity flow to open an encrypted Passport file.

## Structure

- [`wrappingKeyApiClient.ts`](./wrappingKeyApiClient.ts) owns the result types, HTTP request, and strict response validation.
- [`wrappingKeyApiClient.test.ts`](./wrappingKeyApiClient.test.ts) covers request secrecy, response bounds, schemas, and error mapping.

## Request Flow

1. Send only `{ "googleIdToken": "..." }` with no-store and no-referrer protections.
2. Bound and parse the response.
3. Accept only a canonical base64url value representing exactly 32 bytes, or return a safe typed error.
