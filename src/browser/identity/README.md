# Browser Identity

This feature owns the browser's Pubky identity catalog, Google-backed identity
establishment, and the safe controller consumed by UI components.

## Controller

`passportIdentityController.ts` is the only identity module UI code should import. It:

- Constructs and uses the local identity repository and Google authorization client directly.
- Lazily constructs Google-backed custody operations only when an action needs them.
- Coordinates one-shot Google authorization and identity actions.
- Maps internal failures to safe UI results and progress states.
- Owns cancellation, single-flight execution, subscriptions, and cleanup.

## Subfeatures

- `local/` owns localStorage persistence, active identity selection, and
  focused save/restore operations for 32-byte Pubky secrets.
- `google-backed/` restores or creates and activates a Pubky identity using
  short-lived Google and Drive credentials.

Provider credential acquisition remains in sibling `browser/google-authorization`.
Its MVP implicit popup returns short-lived ID and Drive access tokens directly to
browser memory after parser-time fragment scrubbing and account binding.
