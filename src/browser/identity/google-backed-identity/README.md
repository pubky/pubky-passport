# Google-Backed Identity

This browser feature creates, restores, and development-resets the identity backed
by an encrypted Google Drive Passport file.

## Flow

`composition/createGoogleBackedIdentityRuntime.ts` is the feature composition root. It wires
the application use cases to Passport-file storage and crypto, Pubky key and
activation operations, local identity persistence, Homegate invitation retrieval,
and the Passport wrapping-key endpoint.

```txt
request wrapping key -> read encrypted Drive file -> restore or create identity
```

Creation continues through encrypted Drive storage, Homegate invitation, homeserver
signup, discovery publication, and local save. Restoration decrypts the Drive file,
performs blocking sign-in, verifies the identity, and saves it locally.

## Structure

- `application/` owns lifecycle orchestration and its public controller contracts.
- `homegate-invitation/` owns the invitation application contract and browser adapter.
- `wrapping-key/` owns the application contract and adapter for Passport's server API.
- `composition/createGoogleBackedIdentityRuntime.ts` is the only file in this feature that
  constructs concrete dependencies.

Google sign-in, Drive access, and shared GIS loading are separate sibling capabilities
because they acquire credentials for multiple identity actions rather than establish an identity.
Passport-file and Pubky implementations remain separate reusable browser features.

## Runtime Boundary

`HOMEGATE_URL` is validated and normalized by
`src/server/config/browserBootstrapConfig.ts`. Server-rendered UI passes the safe
base URL into the browser identity factory; the Homegate adapter deliberately trusts
that bootstrap contract. Browser modules never import the server config module.
Google ID tokens are sent only to Homegate invitation verification and Passport's
wrapping-key endpoint. Drive access tokens are supplied only to the Drive store.
Wrapping material and decrypted key bytes stay in browser flow variables.
