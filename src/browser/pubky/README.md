# Browser Pubky

Owns the concrete Pubky SDK adapter and browser-local opaque key handles.
`browserPubky` implements the Pubky ports and contains the only production SDK
imports.

Keypairs remain in browser memory and must never enter UI state, storage, logs, or
server requests.
