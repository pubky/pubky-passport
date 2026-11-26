# @pubky/passport-auth

Sign people in to your app with [Pubky Passport](https://passport.pubky.app). The package opens
the Passport popup, handles its messages and returns a Pubky SDK `Session`. It has no UI: your app
draws its own button.

## Install

```bash
pnpm add @pubky/passport-auth @synonymdev/pubky
```

`@synonymdev/pubky` (0.18.x) is a peer dependency. Use one copy of it: the `Pubky` instance you
pass and the package must load the same SDK module, or the SDK rejects the request.

## Sign in

```ts
import { Pubky } from "@synonymdev/pubky";
import { createPassportAuth } from "@pubky/passport-auth";

const passport = createPassportAuth({
  pubky: new Pubky(),
  capabilities: "/pub/example.app/:rw",
  clientId: "example.app",
  appName: "Example App",
  callbackUrl: "/passport/return", // optional, see below
});

button.addEventListener("click", async () => {
  const result = await passport.signIn();
  if (result.ok) {
    // Authenticated. Inspect result.session.info.capabilities before relying on them.
  } else if (result.reason === "popup-blocked") {
    // Ask the person to click again.
  }
});
```

Call `signIn()` straight from the click or tap handler: the popup opens before the first `await`,
otherwise the browser blocks it. A blocked popup returns `popup-blocked` at once and starts
nothing, so ask the person to click again.

`signIn()` never rejects. It resolves with `{ ok: true, session }` or `{ ok: false, reason, error? }`:

| `reason`        | Meaning                                                           |
| --------------- | ----------------------------------------------------------------- |
| `popup-blocked` | The browser did not open the popup.                               |
| `cancelled`     | The person cancelled in Passport.                                 |
| `rejected`      | Passport could not approve the request.                           |
| `popup-closed`  | The popup closed and no approval reached the relay.               |
| `timeout`       | No approval within `timeoutMs`.                                   |
| `aborted`       | Your `signal`, `cancel()` or `dispose()` ended the attempt.       |
| `failed`        | The Pubky SDK or the relay failed; `error` holds the SDK's error. |

Only the `Session` signs the person in. Passport's messages and the callback page only end an
attempt early. After Passport reports `success` and closes the popup, the package keeps polling
for up to 30 seconds before it returns `popup-closed`. A poll that hits a network error or a relay
5xx/429 is retried up to three times in a row; any other SDK error ends the attempt as `failed`.

Save the session with `pubky.browserSessionStore.save(session)` if it must survive a reload.

One attempt runs at a time. Calling `signIn()` again while one is pending focuses the open popup
and returns the same promise (a `signal` passed to that second call is not used).

```ts
passport.state; // "idle" | "pending"
const unsubscribe = passport.subscribe((state) => {
  button.disabled = state === "pending";
});
passport.cancel(); // ends a pending attempt with "aborted"
passport.dispose(); // ends it and refuses new attempts
await passport.signIn({ signal: AbortSignal.timeout(60_000) });
```

### Options

| Option         | Default                      | Notes                                                                                   |
| -------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| `pubky`        |                              | Your app's `Pubky` instance.                                                            |
| `capabilities` |                              | Comma-separated, e.g. `/pub/example.app/:rw`. Roots (`/`, `/pub`, `/priv`) are refused. |
| `clientId`     |                              | Your app's identifier, typically its domain.                                            |
| `appName`      |                              | Shown in Passport, at most 128 characters. Not a verified identity.                     |
| `instance`     | `https://passport.pubky.app` | Passport origin. `http` only on `localhost`, `127.0.0.1` or `[::1]`.                    |
| `callbackUrl`  | none                         | Callback page on this page's origin, HTTPS only.                                        |
| `timeoutMs`    | `300000`                     | Deadline for one attempt.                                                               |

Any `e` action (scoped encryption keys) makes the request use the SDK's signed approval
(`signedApprovalV1`). Check `session.grant?.encryptionKeys.scopes`: the person can decline keys.

`createPassportAuth` throws a `PassportConfigError` for options Passport would refuse. Create it in
the browser; it needs the page's origin.

## Callback page

Passport hands the outcome to your page with a message, which the package acknowledges. When it
cannot (no opener, or no acknowledgement within three seconds), Passport navigates the popup to
`callbackUrl`. Serve a small page there:

```ts
import { handlePassportReturn } from "@pubky/passport-auth/return";

const result = handlePassportReturn();
// "forwarded": sent to the opener, the popup closes itself.
// "no-opener": opened on its own, show a link back to your app.
// "invalid": no outcome in the URL.
```

Always render a visible link back to your app. Keep the page light: it should not start your
app's own session restore inside the popup.

Without `callbackUrl`, Passport shows its own result screen. The package then notices only that
the popup closed: it polls the relay once more (the approval may already be there) and otherwise
returns `popup-closed`. Over plain HTTP, leave `callbackUrl` out: Passport accepts only HTTPS
callbacks.

## Deployment

- `Cross-Origin-Opener-Policy: same-origin` on your page cuts the popup off. Use
  `same-origin-allow-popups` if you need COOP.
- Allow the HTTP relay, the pkarr relays and the homeservers the SDK contacts in your CSP
  `connect-src`.
- Passport cannot run in an iframe (`frame-ancestors 'none'`); the package always uses a popup.
- The authorization URL holds the relay secret or the HPKE key. The package never logs it; do not
  log `window.open` or navigation calls in your own instrumentation.

See [Integrating with Pubky Passport](../../docs/integration.md) for the protocol underneath.
