# Google Wrapping Key API

`POST /api/wrapping-key/google` exchanges a valid Google ID token for the
deterministic wrapping key used by the browser to open that account's encrypted
Passport file.

## Structure

- [`route.ts`](./route.ts) creates the configured server flow and exports the Next.js `POST` handler.
- [`handler.ts`](./handler.ts) translates HTTP input and server results into status codes and safe JSON.
- [`routePolicy.ts`](./routePolicy.ts) bounds and strictly parses the request and defines security headers.
- [`route.test.ts`](./route.test.ts) and [`routePolicy.test.ts`](./routePolicy.test.ts) cover transport, parsing, headers, composition reuse, and error mapping.

## Request Flow

1. Accept only JSON shaped as `{ "googleIdToken": "..." }`, bounded to 16 KiB.
2. Delegate verification, rate limiting, and HKDF derivation to [`src/server/wrapping-key/google/`](../../../../server/wrapping-key/google/).
3. Return `{ "wrappingKey": "<32-byte-base64url>" }` or `{ "error": { "code": "..." } }`.


