# Google Wrapping Key API Route

`POST /api/wrapping-key/google` exchanges a valid Google ID token for the
deterministic wrapping key used by the browser to open that account's encrypted
Passport file.

## Structure

- [`route.ts`](./route.ts) creates the configured server flow and exports the Next.js `POST` handler.
- [`handler.ts`](./handler.ts) translates HTTP input and server results into status codes and safe JSON.
- [`routePolicy.ts`](./routePolicy.ts) bounds and strictly parses the request and defines security headers.
- [`handler.test.ts`](./handler.test.ts) and [`routePolicy.test.ts`](./routePolicy.test.ts) cover transport, parsing, headers, composition reuse, and error mapping.

## Request Flow

1. Accept bounded JSON containing `googleIdToken` and an optional public `keyId`.
2. Delegate verification, key selection, and HKDF derivation to [`src/server/wrapping-key/google/`](../../../../server/wrapping-key/google/).
3. Return the wrapping key and selected key ID, or a safe typed error.
