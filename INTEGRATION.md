# Integrating Pubky Passport

Passport accepts both Pubky Auth request types:

- Cookie authentication: `pubkyauth://signin...`
- Grant authentication: `pubkyauth://signin_grant...`

The client creates the Pubky Auth request and opens:

```txt
https://passport.pubky.app/authorize#d=<encoded-pubkyauth-url>
```

The `d` value must be encoded once and placed in the URL fragment. The request may
use any structurally valid HTTPS Pubky Auth relay. Passport does not define a separate
relay parameter or require relay registration.

## Popup Flow

1. Open Passport from a user action so the browser allows the popup.
2. Keep the original app tab waiting for the Pubky Auth relay result.
3. Treat the relay result as authentication and use Passport messages only for UX.
4. Close the popup after approval, cancellation, or error.

Passport sends the validated callback origin:

```ts
{
  type: "pubky-passport.authorization-outcome",
  version: 1,
  outcome: "success" | "error" | "cancel",
  messageId: string
}
```

The client should verify the Passport origin and popup window, then acknowledge the
same `messageId` with type `pubky-passport.authorization-outcome-ack` and version `1`.
Passport closes after acknowledgement. Without acknowledgement or a live opener, it
navigates to the corresponding validated success, error, or cancel callback.

All supplied callbacks must be HTTPS and share one origin. Direct navigation may be
used as the popup-blocked or mobile fallback.

The Pubky Auth URL contains a secret. Do not log, render, analyze, or persist it, and
do not embed Passport in an iframe.
