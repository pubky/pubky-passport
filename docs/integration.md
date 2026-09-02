# Integrating with Pubky Passport

Pubky Passport approves authorization requests created by the Pubky SDK. Your app creates a
request, opens Passport, and waits for the SDK to receive the approval through the relay.

> Authenticate the user only after the Pubky SDK returns a `Session`. Passport callbacks and
> messages describe the UI outcome; they are not credentials.

Grant auth is recommended for new integrations.

## Flow

1. Your app starts a Pubky auth flow.
2. Your app opens Passport with the flow's authorization URL.
3. The user approves or rejects the request in Passport.
4. The SDK verifies the relay response and returns a `Session`.

The authorization URL contains secrets. Keep it in the browser, encode it exactly once, and never
log it or send it to analytics.

## Popup example

Install the SDK:

```bash
pnpm add @synonymdev/pubky
```

Call `signInWithPassport()` directly from a click or tap handler. The popup must open before the
first `await`, otherwise the browser may block it.

```ts
import { AuthFlowKind, Pubky, type Session } from "@synonymdev/pubky";

const PASSPORT_ORIGIN = "https://passport.pubky.app";
const CALLBACK_PATH = "/auth/passport/return";
const pubky = new Pubky();

type Outcome = "success" | "error" | "cancel";

export async function signInWithPassport(): Promise<Session> {
  const popup = window.open(
    "about:blank",
    `pubky-passport-${crypto.randomUUID()}`,
    "popup,width=520,height=760",
  );
  if (!popup) throw new Error("Passport popup was blocked");

  try {
    const callbackUrl = (outcome: Outcome) => {
      const url = new URL(CALLBACK_PATH, window.location.origin);
      url.searchParams.set("outcome", outcome);
      return url.href;
    };

    const flow = await pubky.startGrantAuthFlow("/pub/example.app/:rw", AuthFlowKind.signin(), {
      clientId: "example.app",
      xCallback: {
        xSource: "Example App",
        xSuccess: callbackUrl("success"),
        xError: callbackUrl("error"),
        xCancel: callbackUrl("cancel"),
      },
    });

    try {
      popup.location.replace(passportUrl(flow.authorizationUrl));
      return await flow.awaitApproval();
    } finally {
      flow.free();
    }
  } finally {
    try {
      if (!popup.closed) popup.close();
    } catch {
      // Closing a cross-origin popup is best effort.
    }
  }
}

function passportUrl(authorizationUrl: string): string {
  return `${PASSPORT_ORIGIN}/authorize#d=${encodeURIComponent(authorizationUrl)}`;
}
```

Replace the capability and `clientId` with values belonging to your app. Request only the access
you need. Save the returned session with `pubky.browserSessionStore.save(session)` if it must
survive a page reload. `flow.awaitApproval()` has no built-in timeout, so ensure your app-level
timeout also ends the wait and frees the flow. Create a fresh flow after a failure or expiry.

## Callbacks

Provide HTTPS callbacks for success, error, and cancellation. They may use different paths or query
strings, but must share one origin. A callback is a navigation fallback and may display the UI
outcome; it must not sign the user in. Older links may use `callback` as the success fallback.

Always render a visible return link on the callback page. Treat its URL as untrusted input. If the
page needs authenticated state, resume the SDK flow and wait for a `Session`.

When Passport has access to the popup's opener, it first sends:

```ts
type PassportOutcomeMessage = {
  type: "pubky-passport.authorization-outcome";
  version: 1;
  outcome: "success" | "error" | "cancel";
  messageId: string;
};
```

For opener messaging, the callbacks must use the same origin as the page that opened the popup. If
your app listens for this optional message, verify the exact Passport origin, confirm `event.source`
is the popup for the current attempt, and validate every field. Then acknowledge the same
`messageId` within three seconds:

```ts
function acknowledgePassport(popup: Window, message: PassportOutcomeMessage): void {
  popup.postMessage(
    {
      type: "pubky-passport.authorization-outcome-ack",
      version: 1,
      messageId: message.messageId,
    },
    PASSPORT_ORIGIN,
  );
}
```

Use the exact Passport origin as `targetOrigin`, never `"*"`. Without a valid acknowledgement,
Passport navigates to the matching callback.

A `success` message means approval was submitted; keep waiting for `flow.awaitApproval()`. Error
and cancellation messages may end the UI attempt early, but none of these messages authenticate
the user.

## Browser requirements

- Build the Passport URL as `/authorize#d=<encoded-request>`. Do not put `d` in the query string.
- Set `xSource` to a short display name. Passport separately shows the callback domain because
  `xSource` is not a verified identity.
- Do not use `noopener` or `noreferrer` when opener messaging is expected.
- `Cross-Origin-Opener-Policy: same-origin` can sever `window.opener`; use
  `same-origin-allow-popups` where appropriate or rely on callback navigation.
- Add the selected HTTP relay to CSP `connect-src` when your app restricts network destinations.
- Do not embed Passport in an iframe.

## Same-tab navigation

Before replacing the current page with Passport, save local grant state with `flow.saveLocal()` in
`sessionStorage`. On the callback route, restore it with `pubky.resumeGrantAuthFlow(savedState)` and
delete it as soon as the flow completes or is abandoned. Never use `localStorage`: resumable state
contains the relay secret and Proof-of-Possession key material.
