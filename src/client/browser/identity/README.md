# Browser Identity

This feature owns the browser's Pubky identity catalog, Google-backed identity
establishment, and the safe controller consumed by UI components.

## Controller

`passportIdentityController.ts` is the only identity module UI code should import. It:

- Exposes explicit local entry points such as `listIdentities`, `selectIdentity`,
  `removeIdentity`, and `createEncryptedBackup`.
- Starts one screen-scoped Google identity flow for each setup or detachment screen.
- Keeps local catalog management separate from Google authorization lifecycle state.

`google-backed/googleBackedIdentityFlow.ts` owns the stateful Google workflow. Its
public operations map directly to user actions: establish, replace an incomplete
identity, detach, retry authorization, and dispose. Short-lived Google credentials
remain inside the flow; only safe progress, errors, account profile data, and public
Pubky identity data cross into UI code.

## Subfeatures

- `local/` owns localStorage persistence, active identity selection, and
  focused save/restore operations for 32-byte Pubky secrets.
- `google-backed/` restores or creates and activates a Pubky identity using
  short-lived Google and Drive credentials.

Provider credential acquisition remains in sibling `browser/google-authorization`.
Its MVP implicit popup returns short-lived ID and Drive access tokens directly to
browser memory after parser-time fragment scrubbing and account binding.
