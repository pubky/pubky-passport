# Authorization

This feature handles one Pubky Auth request through a linear flow:

1. Capture and scrub the request fragment before hydration.
2. Parse it into safe review data plus an opaque issued request.
3. Review it with one explicitly selected local identity.
4. Approve or cancel before the fixed request deadline.
5. Complete the validated callback or show a local terminal state.

## UI API

React uses only:

- `PassportAuthorizationController` for review state and approve/cancel intents.
- `submitManualAuthorizationInput` for pasted requests.

The UI receives review data, never the raw authorization URL, secret, or callback
URLs. A callback host may be shown only as an unverified return destination.
`approve(publicKeyZ32)` binds approval to the identity displayed when the user clicks
Authorize, even if another tab changes the active identity meanwhile.

## Runtime Pieces

- `authorizationEntryBootstrap.ts` retains the pre-hydration entry until the
  controller takes it or its deadline expires.
- `authorizationEntry.ts` consumes and scrubs browser input, then issues a request.
- `IssuedPubkyAuthRequest.ts` owns safe review data and private request metadata.
- `PassportAuthorizationController.ts` owns the request deadline, abandonment,
  state flow, selected-key restoration, approval, and SDK cleanup.
- `completeAuthorizationOutcome.ts` tries acknowledged popup completion, then falls
  back to the exact validated callback.

The protocol parser is split into `pubkyAuthRequestParser.ts`,
`pubkyAuthCapabilities.ts`, and `pubkyAuthUrls.ts`. These modules are stateless and
keep protocol validation separate from browser and SDK lifecycles.

## Security Invariants

- The raw authorization URL, secret, and complete callbacks never enter UI state.
- Only the exact live `IssuedPubkyAuthRequest` can retrieve approval data.
- Review expires at the original entry deadline, including after hydration, and the
  deadline is checked again immediately before SDK approval.
- Approval uses the exact public key passed from the rendered identity review.
- Private request data is released after an outcome is selected or review expires.
- Success, error, and cancellation use only their validated callback.
- Fragment capture and native History API scrubbing happen before hydration.

## Reading Order

1. `authorizationEntryBootstrap.ts`
2. `authorizationEntry.ts`
3. `IssuedPubkyAuthRequest.ts`
4. `PassportAuthorizationController.ts`
5. `completeAuthorizationOutcome.ts`
