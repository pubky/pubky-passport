# Browser Authorization

Owns browser entry into `/authorize`, safe capability review, approval with the
active local Pubky identity, callback navigation, and the controller consumed by the
authorization UI. Pure Pubky Auth request grammar remains in `core/auth`; identity
persistence and concrete SDK key handling remain in their owning browser features.

## Stable UI Entries

- `passportAuthorization.ts` exports the configured controller factory, its
  instance-only controller contract, and safe view-state types. It is the only
  authorization-controller module UI code imports.
- `browserManualAuthorization.ts` validates pasted SDK requests and starts a
  fragment-backed authorization document reload.

`passportAuthorizationController.ts` is the internal state machine. It owns
single-shot approval, safe state transitions, subscriptions, outcome-specific popup
completion or callback navigation, and local terminal fallbacks.

## Internal Responsibilities

- `browserAuthorizationRequest.ts` converts shared validated request data into an
  immutable safe review and an exact browser-issued approval capability. Canonical
  callbacks remain in private weak metadata keyed by that approval object.
- `instrumentation-client.ts` loads `browserAuthorizationBootstrap.ts` before
  hydration. On `/authorize`, it invokes `browserAuthorizationEntry.ts` to capture
  and synchronously scrub the fragment into module-private state before parsing. A
  short-lived per-window cache still protects repeated pre-commit initialization.
- `approveAuthorizationWithActiveIdentity.ts` restores the active local identity,
  approves with the same concrete `PubkySdkAdapter`, and always disposes the restored
  key handle.
- `passportAuthorization.ts` consumes the early entry, constructs the controller,
  and owns final disposal of that adapter.
- `browserAuthorizationOutcome.ts` posts a finite outcome to a live opener at the
  exact validated callback origin and closes the script-opened window only after an
  exact-origin acknowledgement. Callback navigation follows a short timeout when
  popup completion is unavailable.
