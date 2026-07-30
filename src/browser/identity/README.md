# Browser Identity

Owns the safe identity controller, local Pubky identity custody, and the Google-backed
custody/recovery strategy.

## Features

- `local-identity/` stores the identity catalog, active identity ID, and each
  identity's 32-byte Pubky secret.
- `google-backed-identity/` consumes the Google ID token and Drive OAuth storage credential to restore
  or create and activate a Pubky identity.

Provider credential acquisition belongs to sibling `browser/google-sign-in`,
`browser/google-drive-access`, and `browser/google-identity-services` features.
`google-backed-identity` owns only the identity lifecycle ordering that consumes those
credentials.

## Google-Backed Flow

`GoogleBackedIdentityOperations` in
`google-backed-identity/googleBackedIdentityOperations.ts` implements the
Google-backed custody/recovery operations. It accepts
`GoogleBackedIdentityCredentials` and wires application use cases to Passport file
storage and crypto, Pubky operations, local persistence, Homegate homeserver signup
invitation retrieval, and `WrappingKeyApiClient.requestGoogleWrappingKey`.

```txt
request wrapping key -> read Google Drive Passport file -> restore or create Pubky identity
```

Creation continues through encrypted Passport file storage, a homeserver signup
invitation, homeserver signup, discovery publication, and local save. Restoration decrypts the Passport file,
performs blocking sign-in, verifies the identity, and saves it locally.

Inside this lifecycle feature, flat modules own focused orchestration steps while
`GoogleBackedIdentityOperations` constructs their concrete dependencies.

## Security Boundary

Google ID tokens are sent only to Homegate signup-invitation verification and Passport's
wrapping-key endpoint. Drive OAuth access tokens are supplied only to the Drive store.
Wrapping keys, wrapping key material, and decrypted key bytes stay in browser flow variables. Browser
identity modules never import server configuration directly; validated bootstrap
values are injected through the browser identity factory.
