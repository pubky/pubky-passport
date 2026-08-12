# Browser Identity

This feature owns the browser's Pubky identity catalog, Google-backed identity
establishment, and the safe controller consumed by UI components.

## Why Two Root Files?

The public feature entry and the stateful implementation are deliberately separate.

### `passportIdentity.ts`

This is the only identity module UI code should import. It:

- Exposes `createPassportIdentityController()`.
- Exposes the safe, instance-only `PassportIdentityController` type and UI state types.
- Constructs the local identity repository and the browser-only Google implicit authorization client.
- Lazily constructs Google-backed custody operations only when an action needs them.
- Keeps the implementation constructor and its credential-bearing dependencies out
  of the public UI entry.

`createPassportIdentityController()` is a function because it is a composition
factory. It wires dependencies and returns the stateful controller; introducing a
second class would create another lifecycle object without adding behavior.

### `passportIdentityController.ts`

This is the internal state machine. It:

- Coordinates one-shot Google authorization and identity actions.
- Maps internal failures to safe UI results and progress states.
- Owns cancellation, single-flight execution, subscriptions, and cleanup.
- Receives focused callbacks from `passportIdentity.ts` instead of constructing
  repositories or provider adapters itself.

Keeping composition and behavior separate gives the UI one stable, safe entry while
allowing the controller state machine to be tested independently.

## Subfeatures

- `local/` owns localStorage persistence, active identity selection, and
  focused save/restore operations for 32-byte Pubky secrets.
- `google-backed/` restores or creates and activates a Pubky identity using
  short-lived Google and Drive credentials.

Provider credential acquisition remains in sibling `browser/google-authorization`.
Its MVP implicit popup returns short-lived ID and Drive access tokens directly to
browser memory after parser-time fragment scrubbing and account binding.
