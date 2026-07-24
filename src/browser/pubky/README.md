# Browser Pubky

Owns the concrete Pubky SDK adapter and browser-local opaque key handles.
`ports.ts` defines the browser-confined key, session, and secret-material contracts;
`browserPubky` implements those ports and contains the only production SDK imports.

Keypairs remain in browser memory and must never enter UI state, storage, logs, or
server requests.
