# @pubky/passport-client

One "Continue with Pubky" button that signs people in with their Pubky identity through Pubky
Passport. It opens Passport in a pop-up (or in the same tab where a pop-up cannot work), shows a
Pubky Ring QR code and link in the large style, and by default makes sure the person has a
pubky.app profile. Your app receives a real SDK `Session`, the public key and the validated
profile. Only an SDK `Session` authenticates; a pop-up message is only a UI signal.

Status: a private workspace package, not published to npm yet; a release needs the maintainer's
go-ahead. The default Passport is `https://passport.pubky.app`. The package has no runtime
dependencies of its own; your app supplies two peers: `@synonymdev/pubky` (0.11 or 0.12) and
`pubky-app-specs` (0.7, loaded only after a sign-in, to validate the profile). The
[integration guide](../../docs/integration.md) walks through a whole integration.

## The element

```html
<pubky-passport app-name="Example App" capabilities="/pub/example.app/:rw"></pubky-passport>
<script type="module">
  import "@pubky/passport-client/element";
  const button = document.querySelector("pubky-passport");
  button.addEventListener("passport-session", (event) => {
    const { session, publicKey, profile } = event.detail; // the Session is yours to keep
  });
  // After your sign-out (await session.signout()), show the button again: button.reset();
</script>
```

| Attribute      | Default                      | Meaning                                                                    |
| -------------- | ---------------------------- | -------------------------------------------------------------------------- |
| `instance`     | `https://passport.pubky.app` | The Passport people sign in with (people can pick their own)               |
| `app-name`     | the page's host name         | Shown in Passport                                                          |
| `client-id`    | the page's host name         | A stable ID for the app, part of the request                               |
| `capabilities` | `""` (identity only)         | e.g. `/pub/example.app/:rw`; `/`, `/pub`, `/pub/` and `/priv…` are refused |
| `profile`      | `required`                   | `optional` signs in people without a pubky.app profile                     |
| `variant`      | `small`                      | `large` adds the Pubky Ring QR code and link                               |
| `messages`     | English                      | JSON of replacement texts, e.g. `{"label.idle": "Weiter mit Pubky"}`       |

Every attribute is optional. Set them before the element joins the page: the first client or
element on a page finishes a same-tab return with the options it has then. Changing `instance`,
`app-name`, `client-id`, `capabilities` or `profile` starts over; changing `messages` (also a
property) only changes the texts. The element is a dark pill with the Pubky mark; while a sign-in
runs, a cross in it cancels, and errors and the settings (to pick another Passport, kept for your
origin only) open in a popover below. Signed in, it renders nothing until `reset()`. Its one event,
`passport-session` (bubbling, composed), carries `{ session, publicKey, profile }`.

The large style adds Pubky Ring's QR code with Ring's logo in its centre, framed as in Passport
(8px light padding, 8px corners), and at phone size or on a touch screen an "Open in Pubky Ring"
link. Clicking the code copies the exact `pubkyauth://` link it encodes; the code fades while it is
pressed, screen readers hear that it was copied, and only a failure shows a line under it. After a
failed sign-in a fresh code appears by itself.
When the link can no longer be used and the element could not replace it (it expired while the page
was hidden or Pubky Ring was opening it, or preparing it failed), the code turns into a blurred
stand-in tagged "Click to reload", which starts a fresh Ring request without reloading the page; a
dead link is never left scannable.

In React or Next.js, render the tag and listen with a ref; import the element module on the client
only:

```tsx
"use client";
import type { SignedIn } from "@pubky/passport-client";
import { useEffect, useRef } from "react";

export function PassportButton({ onSignedIn }: { onSignedIn: (detail: SignedIn) => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    void import("@pubky/passport-client/element");
    const element = ref.current;
    const listener = (event: Event) => onSignedIn((event as CustomEvent<SignedIn>).detail);
    element?.addEventListener("passport-session", listener);
    return () => element?.removeEventListener("passport-session", listener);
  }, [onSignedIn]);
  return <pubky-passport ref={ref} app-name="Example" />;
}
```

TypeScript needs a JSX declaration for the `pubky-passport` tag; the package ships no React wrapper.

## Headless: your own button

```ts
import { createPassportClient } from "@pubky/passport-client";

const client = createPassportClient({
  appName: "Example App",
  capabilities: "/pub/example.app/:rw",
});
client.subscribe((view) => {
  button.textContent = view.label; // also view.status, view.tone, view.busy
  if (view.signedIn) keep(view.signedIn); // { session, publicKey, profile }
});
button.onclick = () => client.signIn(); // from the click: it opens Passport
```

The options are the attributes' camel-case names (`instance`, `appName`, `clientId`,
`capabilities`, `profile`, `messages`). `signIn()` never rejects; it resolves
`{ status: "signed-in", session, publicKey, profile }`, `{ status: "failed", error }` or
`{ status: "redirecting" }` when this tab is going to Passport. Called while a sign-in runs, it
brings Passport forward; while a required profile is missing, it opens Passport's profile page.
`view.signedIn` holds the Session's details from its arrival until `reset()`, however the sign-in
finished. `reset()` also cancels a sign-in in progress; `dispose()` ends the client.

## What your app receives and does

- A real `@synonymdev/pubky` `Session` with the requested capabilities (checked by the package).
  You own it: keep it, use it, and sign it out when you drop it.
- `publicKey` and `profile`, read once after the sign-in and validated by `pubky-app-specs`
  (`name`, and optionally `bio`, `image`, `links`, `status`). With `profile: "required"` it is always
  there; with `"optional"` it is `null` when the person has none or it could not be read. Treat
  `profile.image` (a `pubky://` URL) and `profile.links[].url` as untrusted input.
- To survive a reload, save the Session with `new Pubky().browserSessionStore.save(session)` and
  `restore(id)` it on start-up. To sign out: `await session.signout()`, then `reset()`.

The demo's [`src/passport.ts`](../../examples/passport-demo/src/passport.ts) does all of this.

## Texts

`messages` replaces any built-in text by key. Templates may use `{appName}`, `{instanceHost}` and
`{defaultHost}`; set as an object (the property or the headless option), a template may also be a
function of those three. The keys are `label.*` (the button), `status.*` (the popover's line),
`action.*`, `error.<code>`, `picker.*` (the settings) and `ring.*` (the large style):

| Key                | Default                            | Where                                     |
| ------------------ | ---------------------------------- | ----------------------------------------- |
| `ring.divider`     | or log in with Pubky Ring          | Between the button and the QR code        |
| `ring.preparing`   | Preparing QR code…                 | While the Ring request is prepared        |
| `ring.qr-label`    | QR code to sign in with Pubky Ring | The code's accessible name                |
| `ring.copy`        | Copy authentication link           | Accessible name of the code's copy action |
| `ring.copied`      | Link copied                        | Announced after the code was copied       |
| `ring.copy-failed` | Could not copy                     | Shown under the code when copying failed  |
| `ring.expired`     | Click to reload                    | The tag on a code that can't be used      |
| `ring.reload`      | Reload QR code                     | Accessible name of that code              |
| `ring.open`        | Open in Pubky Ring                 | The link to Pubky Ring on a phone         |

The `MessageKey` type lists every key.

## Styling

Style the element from outside with these CSS custom properties: `--passport-brand` (border,
text and accents; white), `--passport-ink` (dark surfaces), `--passport-line` (borders of the
card and popover), `--passport-secondary` and `--passport-on-secondary` (secondary buttons and
their text), `--passport-danger` (error text), `--passport-font`, `--passport-height` (the
button's minimum height) and `--passport-qr-size`. The documented parts are `::part(button)` (the
main button), `::part(settings)` (the settings control), `::part(tray)` (the popover) and
`::part(qr)` (the QR code). Everything else inside the element is internal and may change.

## Errors

A failed sign-in has a readable `error.message` and an `error.code` of type `PassportErrorCode`
(for example `popup_closed`, `cancelled`, `timeout` or `profile_required`). A bad option makes `createPassportClient` throw a `PassportConfigError` (exported as a type; check
`error.name === "PassportConfigError"`) whose `issues` list `{ option, code, message }` without
echoing the value. An element with a bad attribute shows "Passport button not configured".

## Deployment

Serve the page over HTTPS, allow the HTTP relay, PKARR relays and homeservers in `connect-src` and
`'wasm-unsafe-eval'` for the SDK and the specs, and don't use `Cross-Origin-Opener-Policy:
same-origin` (use `same-origin-allow-popups`). The client continues in the same tab when the
browser blocks the pop-up, and goes there straight away in in-app browsers, iOS home-screen web apps
and cross-origin-isolated pages; that needs a top-level HTTPS page with writable `sessionStorage`.
See [Deployment requirements](../../docs/integration.md#deployment-requirements).

[DESIGN.md](./DESIGN.md) describes how the package works inside: its security model, runtime,
same-tab state, QR code and size budgets. Run `pnpm --filter @pubky/passport-client test` for the
unit tests, or `pnpm check` at the repository root for the complete workspace checks.
