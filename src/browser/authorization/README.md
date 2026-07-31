# Browser Authorization

Owns browser entry into `/authorize`, safe capability review, approval with the
active local Pubky identity, callback navigation, and the controller consumed by the
authorization UI. Pure Pubky Auth request grammar remains in `core/auth`; identity
persistence and concrete SDK key handling remain in their owning browser features.

## Stable UI Entries

- `passportAuthorization.ts` exports the configured controller factory, its
  instance-only controller contract, and safe view-state types. It is the only
  authorization-controller module UI code imports.
- `browserManualAuthorization.ts` validates pasted requests and starts a full
  document navigation so the server can install request-specific relay CSP.

`passportAuthorizationController.ts` is the internal state machine. It owns
single-shot approval, safe state transitions, subscriptions, outcome-specific
callback navigation, and local terminal fallbacks.

## Internal Responsibilities

- `browserAuthorizationRequest.ts` converts shared validated request data into an
  immutable safe review and an exact browser-issued approval capability. Canonical
  callbacks remain in private weak metadata keyed by that approval object.
- `browserAuthorizationEntry.ts` synchronously reads and scrubs the query before
  parsing. Its short-lived per-window cache preserves the exact approval object
  across React StrictMode's pre-commit double initializer and is cleared on commit or
  microtask expiry.
- `approveAuthorizationWithActiveIdentity.ts` restores the active local identity,
  approves with the same concrete `PubkySdkAdapter`, and always disposes the restored
  key handle.
- `passportAuthorization.ts` owns construction and final disposal of that adapter.

## Security Boundaries

- Raw `d`, decoded request URLs, secrets, callbacks, and approval capabilities never
  enter React view state, rendered data, or browser persistence. The private
  controller retains the capability without exposing it through its public state.
- Review state contains only capability paths and permissions, callback availability,
  the safe relay host, and an ASCII callback-derived display host.
- Copied or forged approval objects cannot retrieve callbacks or reach SDK approval.
- Query scrubbing remains synchronous; moving it into a React effect would expose the
  request longer than the accepted transport permits.
- Manual entry uses full-document navigation rather than client routing so the exact
  validated relay origin is present in that document's CSP.
- Logs contain typed operation and failure codes only, never sensitive URLs or tokens.
