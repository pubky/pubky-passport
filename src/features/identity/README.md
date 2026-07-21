# Identity Feature

This feature owns provider-neutral Pubky identity models: public identity display
data, opaque identity key handles, exported secret-key representation, and verified
provider identity values. These types are safe for browser and server runtime code
to share without importing a provider SDK.

Server-owned wrapping-key verification and derivation live in `src/server/identity`.
Browser setup, restore, Drive, WebCrypto, and Pubky SDK work live in
`src/browser/identity`. Only browser identity code may combine a Drive envelope with
wrapping material.
