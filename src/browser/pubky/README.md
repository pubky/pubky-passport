# Browser Pubky

Owns the concrete Pubky SDK adapter and browser-local opaque key handles.
`application` contains focused identity-key, session-access, discovery, and
auth-approval contracts without one-file capability trees.
`adapters/pubkySdkAdapter.ts` implements all four because opaque key handles and SDK
cleanup must remain owned by one stateful adapter. It contains the only production
Pubky SDK imports.

Keypairs remain in browser memory and must never enter UI state, storage, logs, or
server requests.
