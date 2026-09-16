# Create an account with SMS or Lightning

`/create-account` offers Google, SMS (Prelude through Homegate), and Lightning.
Google follows the existing Passport/Drive identity flow. After SMS verification
or Lightning payment, **Passport** displays the Ring signup QR. The invite stays
in Passport; it is not returned to the calling app.

## User flow

1. Choose SMS or Lightning and complete verification in Passport.
2. Passport shows **Scan QR Code**. In Ring, choose **Add Pubky → Scan signup QR**.
   On mobile, use **Open Pubky Ring**, or **Show signup QR** to use another device.
3. If Ring is not installed, choose **Need to install Pubky Ring?**. The install
   screen links to both app stores. Returning to scan preserves the same invite.
4. Ring creates the account and holds its keys. When finished, choose **Continue
   to sign in** in Passport to return to the client.
5. The client starts a fresh SDK sign-in flow and waits for Ring approval.

The completion button is a user confirmation, not proof of account creation or
authentication. Passport cannot observe completion of a direct signup in Ring.
Only the SDK's approved session authenticates the user. A standalone Passport
visit also supports SMS/Lightning signup, without a client return button.

The QR uses `pubkyauth://direct_signup?hs=…&st=…`, accepted by Ring's signup
scanner. It contains no client grant or relay secret. The invite stays in memory;
reloading before using it loses the pending invite. If the account was already
created, use normal sign-in. Do not log the invite or include it in analytics.

## Open Passport from a client

Open a popup directly from a user gesture or navigate the current tab:

```ts
const passportOrigin = "https://passport.pubky.app";
const state = crypto.randomUUID();
const callback = "https://your-app.example/auth/signup/return";
const fragment = new URLSearchParams({ callback, state });
const popup = window.open(
  `${passportOrigin}/create-account#${fragment}`,
  "passport-signup",
  "popup,width=520,height=760",
);
```

Persist a fresh state before same-tab navigation. Entry parameters are
fragment-only: `callback` must be HTTPS, at most 2,048 characters, with no
credentials or fragment; `state` must contain 16–128 characters from
`A–Z`, `a–z`, `0–9`, `_`, `-`. The complete fragment is limited to 4,096 characters.
Other parameters, duplicates, query parameters, and client grants are rejected.
Passport removes the entry fragment from history after capture.

## Completion handoff

Only after the user selects **Continue to sign in**, Passport sends:

```ts
{
  type: "pubky-passport.signup-complete",
  version: 1,
  messageId: "<unique message ID>",
  state: "<your attempt state>"
}
```

Validate the exact Passport origin, original popup window, type, version, state,
and message ID. Consume the pending state once and acknowledge synchronously:

```ts
popup.postMessage(
  { type: "pubky-passport.signup-complete-ack", version: 1, messageId: event.data.messageId },
  passportOrigin,
);
```

Duplicate messages may be acknowledged again without starting another sign-in.
Passport waits up to three seconds for acknowledgement, then closes. If the popup
cannot close or no acknowledgement arrives, it navigates to
`https://your-app.example/auth/signup/return#signup=complete&state=…`. The existing
callback query is preserved. Capture and scrub the fragment before rendering;
validate the stored attempt state and consume it once. No invite, key, grant, or
session is returned in either path.

After a validated completion, start `pubky.startGrantAuthFlow(capabilities,
AuthFlowKind.signin(), { clientId })`, or the SDK cookie equivalent. Display the
resulting sign-in QR/deeplink and await SDK approval. Dispose abandoned flows.
The start page and `/authorize` keep their existing behavior.

## Design source and validation

The Ring scan/install layout and illustrations are adapted from
[pubky-app at 50aaaa6](https://github.com/pubky/pubky-app/tree/50aaaa6de03a792fe9e3216462c06e82fea408f2):
`Scan`, `BalancedQrCard`, `QrCodeSlot`, and `Install`. Passport retains its shared
navigation, typography, branding, and store badges. The signup QR uses high error
correction with an excavated logo area. The upstream [MIT license](vendor/pubky-app/LICENSE)
is retained with the copied assets.

Run `pnpm check` and `pnpm test:e2e:run`. Tests mock Homegate and cover verification,
Ring setup inside Passport, install/back navigation, explicit completion, popup
and callback handoffs, and unchanged start/authorize screens. No live SMS or
payment is sent; actual Ring signup and approval still require device testing.
