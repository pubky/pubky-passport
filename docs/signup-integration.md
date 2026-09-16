# Create an account with SMS or Lightning

`/create-account` offers Google, Lightning and SMS using Passport's existing UI.
Google follows the existing Passport/Drive identity flow. SMS (Prelude through
Homegate) and Lightning obtain a homeserver invite and return it to your app.
Your app then starts signup and authorization with Pubky Ring.

Passport does not create keys, consume the invite, or receive the client's
authorization URL on the SMS/Lightning path. The start page and `/authorize`
continue to use their existing flow; see [authorization integration](integration.md).

## Open Passport

Use the user's configured Passport origin. Open the popup directly from a click
handler, or navigate the current tab to the same URL:

```ts
const passportOrigin = "https://passport.pubky.app";
const state = crypto.randomUUID();
const callback = "https://your-app.example/auth/signup/return";
const fragment = new URLSearchParams({ callback, state });
const signupUrl = `${passportOrigin}/create-account#${fragment}`;
const popup = window.open(signupUrl, "passport-signup", "popup,width=520,height=760");
```

For same-tab navigation, keep `state` in your app's session storage before leaving.
Accept one return per attempt, then delete that stored state. An invite message is
not proof of authentication: only the SDK `Session` establishes the user's session.

Entry parameters are fragment-only:

| Parameter  | Contract                                                                     |
| ---------- | ---------------------------------------------------------------------------- |
| `callback` | Absolute HTTPS URL, at most 2,048 characters; no credentials or fragment     |
| `state`    | 16–128 characters from `A–Z`, `a–z`, `0–9`, `_`, `-`; fresh for each attempt |

The complete encoded fragment is limited to 4,096 characters.
Other parameters, duplicates, query parameters, and client grants (`d`, `secret`,
`relay`, etc.) are rejected. The entry fragment is removed from browser history
after capture. The UI shows the callback origin before verification.
A standalone visit displays the method picker; SMS/Lightning explain that signup
must start in a client app so Passport knows where to return the invitation.

## Receive the invitation

After successful verification, a popup sends this message to the callback's exact
origin:

```ts
{
  type: "pubky-passport.signup-invite",
  version: 1,
  messageId: "<unique message ID>",
  state: "<your attempt state>",
  hs: "<homeserver public key in z-base-32>",
  st: "<single-use homeserver signup token>"
}
```

Before accepting it, validate `event.origin === passportOrigin`,
`event.source === popup`, `type`, `version`, `state`, and the payload types. Validate
`hs` with the SDK's `PublicKey.from()` and require a non-empty `st` of at most 1,024
characters. Retain the invite before acknowledging; ignore repeated messages for
the completed attempt. Acknowledge immediately, before starting asynchronous SDK
work:

```ts
popup.postMessage(
  {
    type: "pubky-passport.signup-invite-ack",
    version: 1,
    messageId: event.data.messageId,
  },
  passportOrigin,
);
```

Passport waits up to three seconds for a matching acknowledgement from that opener
and origin, then closes. If there is no opener, no valid acknowledgement, or the
popup cannot close, Passport navigates to:

```text
https://your-app.example/auth/signup/return#hs=…&st=…&state=…
```

Your callback page must capture and remove this fragment before rendering the app,
validate the stored attempt state, and handle the same invitation shape. The
existing callback query is preserved. The invite stays out of HTTP requests and
referrers; do not log it or send it to analytics. A visible **Return to app** link
is available if automatic handoff fails.

## Continue in Ring

Immediately after accepting the invite, the client starts the SDK flow:

```ts
import { AuthFlowKind, PublicKey, Pubky } from "@synonymdev/pubky";

const pubky = new Pubky();
const homeserver = PublicKey.from(hs);
const flow = await pubky.startGrantAuthFlow(
  "/pub/your-app.example/:rw",
  AuthFlowKind.signup(homeserver, st),
  { clientId: "your-app.example" },
);
// Render flow.authorizationUrl as the client's QR code and Open in Ring link.
// On mobile, attempt the deeplink immediately; keep the link for an explicit retry.
// The same-tab callback can use location.replace(flow.authorizationUrl).
const session = await flow.awaitApproval();
```

The client owns the QR, deeplink, relay secret and SDK flow. Never send
`flow.authorizationUrl` to `/create-account`. Ring creates the keys, consumes the
invite, and approves the client session. Keep the **Open in Ring** fallback on
mobile because browsers may suppress a deeplink following an asynchronous return.
The caller must clean up its SDK flow and listeners when completed or abandoned.

## Test and review

```bash
pnpm check
pnpm test:e2e:run
```

`e2e/create-account.spec.ts` mocks Homegate to cover SMS, invalid codes and limits,
Lightning payment and expiry, same-tab and popup returns, accessibility, and the
unchanged start/authorize screens. It does not send SMS or pay live invoices.
For live testing, point `HOMEGATE_URL` at the intended Homegate service and open the
route with a real client callback implementing the contract above. Client chrome,
Ring signup, and the final SDK session remain client/Ring integration work.
