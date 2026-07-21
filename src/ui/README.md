# UI

This folder contains React components and safe display state for Passport screens.
UI may render parsed authorization details, progress labels, public identities, and
typed errors. It must never render or retain raw credentials, key material, auth
request secrets, full callback URLs, or ciphertext.

Client components may use browser feature code to start browser-only flows. They
must not import `src/server` or server environment modules.
Keep routing and HTTP response construction in `src/app`, and keep flow rules in
`src/features`.
