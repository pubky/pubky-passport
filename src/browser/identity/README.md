# Browser Identity

Owns the safe identity controller, local Pubky identity custody, Google credential
acquisition, and Google-backed identity setup and restoration.

## Features

- `local-identity/` stores the identity catalog, active identity ID, and each
  identity's 32-byte Pubky secret.
- `google-identity-services/` loads the shared Google browser SDK and defines its
  browser-facing types. It does not establish a Pubky identity.
- `google-sign-in/` acquires a Google ID token.
- `google-drive-access/` acquires Drive authorization and verifies account ownership.
- `google-backed-identity/` consumes the Google ID and Drive credentials to restore
  or create and activate a Pubky identity.

The capabilities stay separate because acquiring Google credentials is not the same
responsibility as establishing a Pubky identity. Sign-in and Drive authorization can
support multiple identity actions, while `google-backed-identity` owns the lifecycle
ordering for one action.

## Google-Backed Flow

`google-backed-identity/composition/createGoogleBackedIdentityRuntime.ts` wires the
application use cases to Passport-file storage and crypto, Pubky operations, local
persistence, Homegate invitation retrieval, and the wrapping-key endpoint.

```txt
request wrapping key -> read encrypted Drive file -> restore or create identity
```

Creation continues through encrypted Drive storage, Homegate invitation, homeserver
signup, discovery publication, and local save. Restoration decrypts the Drive file,
performs blocking sign-in, verifies the identity, and saves it locally.

Inside this lifecycle feature, `application/` owns orchestration and contracts,
`homegate-invitation/` and `wrapping-key/` own focused provider capabilities, and
`composition/` is the only location that constructs their concrete dependencies.

## Security Boundary

Google ID tokens are sent only to Homegate invitation verification and Passport's
wrapping-key endpoint. Drive access tokens are supplied only to the Drive store.
Wrapping material and decrypted key bytes stay in browser flow variables. Browser
identity modules never import server configuration directly; validated bootstrap
values are injected through the browser identity factory.
