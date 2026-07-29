# Browser Identity

Owns the safe identity controller, local Pubky identity custody, provider-account
credential acquisition, and the Google-backed custody/recovery strategy.

## Features

- `local-identity/` stores the identity catalog, active identity ID, and each
  identity's 32-byte Pubky secret.
- `google-identity-services/` loads the shared Google browser SDK and defines its
  browser-facing types. It does not establish a Pubky identity.
- `google-sign-in/` acquires a Google ID token for the provider account.
- `google-drive-access/` acquires a Drive OAuth storage credential and verifies provider-account ownership.
- `google-backed-identity/` consumes the Google ID token and Drive OAuth storage credential to restore
  or create and activate a Pubky identity.

The capabilities stay separate because acquiring provider-account credentials is not
the same responsibility as establishing a Pubky identity. ID-token acquisition and Drive OAuth authorization can
support multiple identity actions, while `google-backed-identity` owns the lifecycle
ordering for one action.

## Google-Backed Flow

`GoogleBackedIdentityOperations` in
`google-backed-identity/composition/googleBackedIdentityOperations.ts` implements the
Google-backed custody/recovery operations. It accepts
`GoogleBackedIdentityCredentials` and wires application use cases to Passport file
storage and crypto, Pubky operations, local persistence, Homegate homeserver signup
invitation retrieval, and `GoogleWrappingKeyApiClient`.

```txt
request wrapping key -> read Google Drive Passport file -> restore or create Pubky identity
```

Creation continues through encrypted Passport file storage, a homeserver signup
invitation, homeserver signup, discovery publication, and local save. Restoration decrypts the Passport file,
performs blocking sign-in, verifies the identity, and saves it locally.

Inside this lifecycle feature, `application/` owns orchestration and capability contracts,
`browser/homegate` and `wrapping-key/` own focused provider capabilities, and
`composition/` is the only location that constructs their concrete dependencies.

## Security Boundary

Google ID tokens are sent only to Homegate signup-invitation verification and Passport's
wrapping-key endpoint. Drive OAuth access tokens are supplied only to the Drive store.
Wrapping keys, wrapping key material, and decrypted key bytes stay in browser flow variables. Browser
identity modules never import server configuration directly; validated bootstrap
values are injected through the browser identity factory.
