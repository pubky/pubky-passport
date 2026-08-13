# Google Authorization

This feature obtains the two short-lived Google credentials required by a
Google-backed Passport identity from one user action:

- an ID token, used by Passport's wrapping-key API and Homegate to verify the
  Google account;
- a Drive access token, used only in the browser to read or write the encrypted
  Passport files.

## MVP OAuth Flow

The MVP uses Google's deprecated OAuth implicit response in a Passport-owned
popup with `response_type=id_token token`. This avoids a second popup and lets
Passport detect cancellation from the actual popup handle. Google returns to the
Passport origin; a CSP-hash-authorized parser-time bootstrap immediately
scrubs the credential fragment before hydration and sends it only to the exact-origin
opener. The opener requires both the exact origin and exact popup window.

The adapter validates cryptographic state, the ID-token nonce, an explicit scope
allowlist, and UserInfo `sub` binding before returning credentials. It disables
incremental scope inclusion and bounds the attempt to five minutes. This deprecated
flow is an explicit MVP compatibility tradeoff and should be replaced when the
product adopts a supported single-interaction Google flow.

## Boundaries

- `googleImplicitAuthorization.ts` owns OAuth request construction, popup
  lifecycle, response validation, UserInfo binding, and avatar localization.
- The ID and Drive access tokens stay out of React state, persistence, logs, and
  Passport server requests and pass directly into the browser identity use case.
- Passport requests no refresh token.

The OAuth client must register each Passport origin as both an authorized JavaScript
origin and an authorized redirect URI. Local development uses
`https://localhost:3000` for both entries.
