# Authorization

This feature handles one Pubky Auth request through a linear flow:

1. Capture and scrub the request fragment before hydration.
2. Parse it into safe review data plus an opaque issued request.
3. Review it with one explicitly selected local identity.
4. Approve or cancel after any required identity onboarding.
5. Complete the validated callback or show a local terminal state.

## UI API

React uses only:

- `PassportAuthorizationController` for review state and approve/cancel intents.
- `validateManualAuthorizationInput` for pasted requests.

The UI receives review data, never the raw authorization URL, secret, or callback
URLs. A callback host may be shown only as an unverified return destination.
`approve(publicKeyZ32)` binds approval to the identity displayed when the user clicks
Authorize, even if another tab changes the active identity meanwhile.

## Runtime Pieces

- `entry/` owns browser input, early fragment scrubbing, and manual request validation.
- `request/` owns untrusted protocol parsing and the opaque issued request.
- `flow/` owns review state, approval, request lifetime, and outcome handoff.

Within those boundaries:

- `entry/authorizationEntryBootstrap.ts` retains the pre-hydration entry until the
  controller takes it.
- `entry/authorizationEntry.ts` consumes and scrubs browser input, then issues a request.
- `request/IssuedPubkyAuthRequest.ts` owns safe review data and private request metadata.
- `flow/PassportAuthorizationController.ts` owns request abandonment and the finite
  state flow.
- `flow/approveAuthorization.ts` owns selected-key restoration, SDK approval, and
  key-resource cleanup.
- `flow/authorizationOutcomeHandoff.ts` tries acknowledged popup handoff, then falls
  back to the exact validated callback.

The protocol parser is split into `request/pubkyAuthRequestParser.ts`,
`request/pubkyAuthCapabilities.ts`, and `request/pubkyAuthUrls.ts`. These modules
are stateless and keep protocol validation separate from browser and SDK lifecycles.

## Security Invariants

- The raw authorization URL, secret, and complete callbacks never enter UI state.
- Only the exact live `IssuedPubkyAuthRequest` can retrieve approval data.
- Review remains live while the user signs up, restores, or selects an identity.
- Approval uses the exact public key passed from the rendered identity review.
- Private request data is released after an outcome is selected or review is abandoned.
- Success, error, and cancellation use only their validated callback.
- Fragment capture and native History API scrubbing happen before hydration.

## Reading Order

1. `entry/authorizationEntryBootstrap.ts`
2. `entry/authorizationEntry.ts`
3. `request/IssuedPubkyAuthRequest.ts`
4. `flow/PassportAuthorizationController.ts`
5. `flow/approveAuthorization.ts`
6. `flow/authorizationOutcomeHandoff.ts`
