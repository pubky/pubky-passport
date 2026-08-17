# Authorization

This feature receives a Pubky Auth request, renders only safe review data, approves
with the active local identity, and completes the exact validated callback.

## Public Entries

UI code imports only:

- `passportAuthorization.ts` for the authorization controller.
- `manualAuthorizationInput.ts` for pasted authorization links.

`passportAuthorization.ts` is the composition root. It constructs the concrete
identity repository and Pubky adapter while keeping those details out of UI code.

## Subfeatures

- `request/` validates encoded Pubky Auth requests and issues an exact-object
  approval capability. Sensitive request details stay in a private in-memory lookup
  and are available only through the exact approval object.
- `entry/` captures and scrubs the fragment before hydration, bridges React
  StrictMode initialization, and expires unconsumed requests.
- `flow/` coordinates review, active-identity approval, callback selection, and
  outcome completion.

## Security Invariants

- The raw authorization URL, secret, and complete callbacks never enter UI state.
- Only an approval object issued by `request/issuedAuthorizationRequest.ts` can
  retrieve sensitive metadata.
- Architecture tests confine the sensitive parser to request issuance and the
  validation-only manual-entry adapter.
- Approval metadata is released after SDK approval and outcome callback selection.
- One `PubkySdkAdapter` restores the active key and approves the request.
- Success, error, and cancellation use only the callback validated for that outcome.
- Fragment capture and native History API scrubbing remain pre-hydration behavior.

## Reading Order

For the end-to-end flow, read:

1. `entry/authorizationEntryBootstrap.ts`
2. `entry/authorizationEntry.ts`
3. `request/issuedAuthorizationRequest.ts`
4. `flow/authorizationFlowController.ts`
5. `passportAuthorization.ts`
