# Browser Identity

This folder contains the browser-owned parts of Passport identity handling:
Google Drive storage, WebCrypto, Pubky SDK access, and future setup, restore, and
authorization flows. It may import pure identity and Passport-file rules from
`src/features`, but never imports `src/server`.

Only code in this runtime may combine the encrypted Drive envelope with wrapping
material returned by Passport. Keep access tokens, wrapping material, ciphertext,
and decrypted key bytes in narrowly scoped local variables. Do not persist them,
place them in UI state, log them, or send them to server routes.

Provider-specific browser integrations belong in a nested provider folder such as
`google/`, `apple/`, or `proton/` when a provider is explicitly scoped.
