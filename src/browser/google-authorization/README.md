# Google Authorization

This feature obtains the two short-lived Google credentials required by a
Google-backed Passport identity from one user action:

- an ID token, used by Passport's wrapping-key API and Homegate to verify the
  Google account;
- a Drive access token, used only in the browser to read or write the encrypted
  Passport files.

## Why This Requires A Server Step

Google Identity Services separates authentication from API authorization. The
browser Sign in with Google API returns an ID token but cannot also return a
Drive access token. Its browser token API returns a Drive access token but does
not return the ID token Passport needs. Combining those APIs therefore requires
two Google interactions, and attempting to open the second popup automatically
is blocked by modern browsers.

Passport instead uses Google's OAuth authorization-code model. One click calls
`google.accounts.oauth2.initCodeClient().requestCode()` with OpenID and Drive
scopes. Google returns a single-use authorization code containing no usable
Drive or identity credential by itself.

Exchanging that code requires the OAuth client secret. A browser must never
receive that secret, so the browser sends the code to the same-origin
`POST /api/google/authorize` endpoint. The server-only
`server/google-authorization` adapter exchanges it with Google and returns the
short-lived ID and access tokens. Passport does not request, return, or persist a
refresh token.

## Boundaries

- `googleAuthorizationCode.ts` owns GIS loading, popup lifecycle, and the
  same-origin code exchange request.
- `app/api/google/authorize` validates request origin, shape, and size.
- `server/google-authorization` owns the call to Google's token endpoint.
- `GOOGLE_CLIENT_SECRET` is server-only and must never enter browser bootstrap
  configuration, logs, or API responses.
- The authorization code and returned tokens stay out of React state and are
  passed directly into the browser identity use case.

The OAuth client must register each Passport origin as both an authorized
JavaScript origin and an authorized redirect URI. Local development uses
`https://localhost:3000`.
