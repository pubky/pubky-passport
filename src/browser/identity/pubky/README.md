# Browser Pubky SDK

This folder is the only production location that imports `@synonymdev/pubky`.
It has two intentionally distinct layers:

- `pubkySdkKeypair.ts` directly wraps SDK `Keypair` operations.
- `pubkySdkIdentity.ts` directly wraps SDK `Pubky`, signer, signup, discovery, and
  authorization operations using a concrete SDK keypair.
- `browserPubkyIdentity.ts` owns opaque browser key handles and translates identity
  browser identity contracts into those SDK operations.

The browser-facing layer owns disposal of keypairs and SDK facades. No module in
this folder may persist plaintext key material or expose an SDK keypair outside the
in-memory identity flow.
