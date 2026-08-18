# Authorization

This feature receives a Pubky Auth request, renders only safe review data, approves
with the active local identity, and completes the exact validated callback.

## Public Entries

UI code imports only:

- `PassportAuthorizationController` from `PassportAuthorizationController.ts`.
- `submitManualAuthorizationInput` from `manualAuthorizationInput.ts`.

React constructs `PassportAuthorizationController` directly, just as identity UI
constructs `PassportIdentityController`. The controller composes the remaining
authorization classes and exposes only safe state and user intents.

## Classes

- `IssuedPubkyAuthRequest` validates one encoded request and becomes the exact
  authority required for approval. Its `review` property is safe for UI state;
  sensitive request details remain private to the instance.
- `PassportAuthorizationController` owns review state, approval and cancellation
  intents, callback selection, and terminal state transitions.
- `ActiveIdentityAuthorization` restores the active identity, approves with the same
  Pubky adapter, and disposes key and adapter resources.
- `AuthorizationOutcomeHandoff` owns opener acknowledgement, popup closing, and
  callback navigation through its injected `Window`.

## Protocol Model

Pure Pubky Auth grammar remains in focused model modules:

- `pubkyAuthRequestParser.ts`
- `pubkyAuthCapabilities.ts`
- `pubkyAuthUrls.ts`

These are functions because they transform one input into one result and own no
state or lifecycle, matching the Passport file envelope parser style.

## Entry Lifecycle

`authorizationEntry.ts` owns fragment capture, address-bar scrubbing, StrictMode
retention, and absolute expiry. A valid entry carries one `IssuedPubkyAuthRequest`;
it does not duplicate review and approval values. The separate bootstrap module is
loaded before hydration by `instrumentation-client.ts`.

## Security Invariants

- The raw authorization URL, secret, and complete callbacks never enter UI state.
- Only the exact `IssuedPubkyAuthRequest` instance can retrieve approval data.
- Private request data is released after callback selection or entry expiry.
- One `PubkySdkAdapter` restores the active key and approves the request.
- Success, error, and cancellation use only the callback validated for that outcome.
- Fragment capture and native History API scrubbing remain pre-hydration behavior.

## Reading Order

1. `authorizationEntryBootstrap.ts`
2. `authorizationEntry.ts`
3. `IssuedPubkyAuthRequest.ts`
4. `PassportAuthorizationController.ts`
5. `ActiveIdentityAuthorization.ts`
6. `AuthorizationOutcomeHandoff.ts`
