# Browser Pubky

Owns the concrete Pubky SDK adapter and browser-local opaque key handles.
`pubkyIdentityKey.ts` keeps shared key handles, key-material types, and constants
independent from the concrete SDK. `pubkySdkAdapter.ts` owns session access,
discovery, auth approval, opaque keypair state, and SDK resource cleanup. It contains
the only production Pubky SDK imports.

Keypairs remain in browser memory and must never enter UI state, storage, logs, or
server requests.

## Why The Key Contract Is Separate

`pubkyIdentityKey.ts` lets identity, crypto, and storage code share opaque key
handles and key-material metadata without importing `@synonymdev/pubky`.

- Only `PubkySdkAdapter` can resolve a handle to an SDK `Keypair`.
- Storage and crypto can use key constants without gaining signing access.
- SDK object ownership and `free()` cleanup stay in one stateful runtime.

This is a key-custody boundary, not an application-layer convention. Types used only
by the adapter remain in `pubkySdkAdapter.ts`.
