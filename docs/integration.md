# Integrating Pubky Passport

Passport is a signer UI for Pubky authorization requests. Your app starts an authorization flow
with the Pubky SDK, opens Passport in a popup, and waits for the SDK to receive the result through
the relay.

The important rule is:

> Only the `Session` returned by the Pubky SDK authenticates the user. Passport messages and
> callbacks are UI signals, not credentials.

Passport supports grant and cookie sign-in requests. Grant auth is recommended for new apps.

## Client integration

Install the SDK:

```bash
pnpm add @synonymdev/pubky
```

The example below includes popup blocking, outcome acknowledgement, callback fallback, manual
popup closure, relay polling, timeout, and session persistence.

```ts
import { AuthFlowKind, Pubky, type GrantAuthFlow, type Session } from "@synonymdev/pubky";

const PASSPORT_ORIGIN = "https://passport.pubky.app";
const CALLBACK_PATH = "/auth/passport/return";
const CALLBACK_MESSAGE = "example-app.passport-return";
const TIMEOUT_MS = 5 * 60_000;

const pubky = new Pubky();

type Outcome = "success" | "error" | "cancel";

export async function signInWithPassport(): Promise<Session> {
  const attemptId = crypto.randomUUID();

  // Open synchronously from the click handler. Awaiting first may trigger popup blocking.
  const popup = window.open(
    "about:blank",
    `pubky-passport-${attemptId}`,
    "popup,width=520,height=760",
  );
  if (!popup) throw new Error("Passport popup was blocked");

  let outcome: Outcome | undefined;
  let flow: GrantAuthFlow | undefined;

  const onMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== popup || !isRecord(event.data)) return;

    if (
      event.origin === PASSPORT_ORIGIN &&
      event.data.type === "pubky-passport.authorization-outcome" &&
      event.data.version === 1 &&
      isOutcome(event.data.outcome) &&
      typeof event.data.messageId === "string"
    ) {
      // Acknowledge immediately so Passport can close instead of navigating to the callback.
      popup.postMessage(
        {
          type: "pubky-passport.authorization-outcome-ack",
          version: 1,
          messageId: event.data.messageId,
        },
        PASSPORT_ORIGIN,
      );
      outcome = event.data.outcome;
      return;
    }

    // The client callback page uses this path if Passport could not complete postMessage.
    if (
      event.origin === window.location.origin &&
      event.data.type === CALLBACK_MESSAGE &&
      event.data.attemptId === attemptId &&
      isOutcome(event.data.outcome)
    ) {
      outcome = event.data.outcome;
    }
  };

  window.addEventListener("message", onMessage);

  try {
    const callback = (nextOutcome: Outcome) => {
      const url = new URL(CALLBACK_PATH, window.location.origin);
      url.searchParams.set("attempt", attemptId);
      url.searchParams.set("outcome", nextOutcome);
      return url.href;
    };

    flow = await pubky.startGrantAuthFlow("/pub/example.app/:rw", AuthFlowKind.signin(), {
      clientId: "example.app",
      xCallback: {
        xSource: "Example App",
        xSuccess: callback("success"),
        xError: callback("error"),
        xCancel: callback("cancel"),
      },
    });

    const passportUrl = new URL("/authorize", PASSPORT_ORIGIN);
    passportUrl.hash = `d=${encodeURIComponent(flow.authorizationUrl)}`;
    popup.location.replace(passportUrl.href);

    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (outcome === "cancel") throw new Error("Passport authorization was cancelled");
      if (outcome === "error") throw new Error("Passport could not approve the request");
      if (popup.closed && outcome !== "success") throw new Error("Passport popup was closed");

      // This relay result, not outcome === "success", completes authentication.
      const session = await flow.tryPollOnce();
      if (session) {
        const store = pubky.browserSessionStore;
        try {
          await store.save(session);
        } finally {
          store.free();
        }
        return session;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }

    throw new Error("Passport authorization timed out");
  } finally {
    window.removeEventListener("message", onMessage);
    flow?.free();
    try {
      if (!popup.closed) popup.close();
    } catch {
      // Closing a cross-origin popup is best effort.
    }
  }
}

function isOutcome(value: unknown): value is Outcome {
  return value === "success" || value === "error" || value === "cancel";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

Call `signInWithPassport()` directly from a click or tap handler. Replace the example capability
and `clientId` with values belonging to your app. Request only the access you need.

## Callback page

Use one HTTPS callback route for all outcomes. It is a fallback for missing openers, failed
messaging, missing acknowledgements, or a popup that cannot close.

```ts
const CALLBACK_MESSAGE = "example-app.passport-return";
const params = new URLSearchParams(window.location.search);
const attemptId = params.get("attempt");
const value = params.get("outcome");
const outcome = value === "success" || value === "error" || value === "cancel" ? value : null;

if (attemptId && outcome && window.opener && !window.opener.closed) {
  window.opener.postMessage({ type: CALLBACK_MESSAGE, attemptId, outcome }, window.location.origin);
  window.close();
}
```

Always render a visible return link because the callback may be opened without an opener. Callback
query parameters are untrusted and must not sign the user in.

## Message contract

Passport sends this message to the origin of the callback matching the outcome:

```ts
{
  type: "pubky-passport.authorization-outcome",
  version: 1,
  outcome: "success" | "error" | "cancel",
  messageId: string
}
```

Verify both `event.origin === PASSPORT_ORIGIN` and `event.source === popup`, then respond within
three seconds:

```ts
{
  type: "pubky-passport.authorization-outcome-ack",
  version: 1,
  messageId: receivedMessageId
}
```

Use the exact Passport origin as `targetOrigin`, never `"*"`. Without a valid acknowledgement,
Passport navigates the popup to the matching callback.

## Required configuration

- Construct the Passport URL as `/authorize#d=${encodeURIComponent(flow.authorizationUrl)}`.
  Encode exactly once and do not put `d` in the query string.
- All callbacks must use HTTPS and share one origin. Their paths and query strings may differ.
- Provide success, error, and cancel callbacks. `callback` is accepted only as a legacy success
  fallback.
- Set SDK `xSource` to a short, human-readable app name. Passport shows it as a friendly label and
  separately shows the HTTPS callback domain; `xSource` is not a verified identity or domain.
- Do not use `noopener` or `noreferrer` if direct popup messaging is expected.
- `Cross-Origin-Opener-Policy: same-origin` may break `window.opener`. Use
  `same-origin-allow-popups` where appropriate, or rely on callback navigation.
- Add the selected HTTP relay to the client CSP `connect-src` if your CSP restricts connections.
- Do not embed Passport in an iframe.

## Handling outcomes

| Result                          | Meaning                                              |
| ------------------------------- | ---------------------------------------------------- |
| SDK returns `Session`           | Authentication succeeded                             |
| Passport `success`              | Approval was submitted; continue waiting for the SDK |
| Passport `error`                | Passport could not approve the request               |
| Passport `cancel`               | The user cancelled                                   |
| Popup closes without an outcome | The attempt was interrupted                          |
| SDK throws                      | Relay, network, or approval failure                  |
| No result before the deadline   | Discard the flow and retry with a new one            |

Never edit and reuse a rejected authorization URL. Start a fresh SDK flow with a fresh relay secret.

## Direct navigation

If you navigate the current tab to Passport instead of opening a popup, save resumable flow state
in `sessionStorage` first:

- grant: `flow.saveLocal()` and `pubky.resumeGrantAuthFlow(savedState)`;
- delegated grant: `flow.saveDelegated()` and `pubky.resumeDelegatedGrantAuthFlow(savedState)`;
- cookie: save `flow.authorizationUrl` and use `pubky.resumeCookieAuthFlow(url)`.

Delete pending state after completion, failure, cancellation, or timeout. It contains sensitive
relay and Proof-of-Possession material.

## Security and test checklist

- Only an SDK `Session` or verified SDK token creates authenticated state.
- Never log, persist, or send the Passport URL or pending flow state to analytics.
- Validate exact message origin, popup source, type, version, outcome, and `messageId`.
- Correlate callback messages with an unpredictable per-attempt ID.
- Test approval, UI success without relay success, error, cancel, popup close, popup blocking,
  callback fallback, wrong-origin messages, timeout, and concurrent attempts.
