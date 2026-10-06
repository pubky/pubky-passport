# @pubky/passport-client

One "Continue with Pubky" button that signs people in with their Pubky identity through Pubky
Passport. It opens Passport in a pop-up (or in the same tab where a pop-up cannot work), shows a
Pubky Ring QR code and link in the large style, and by default makes sure the person has a
pubky.app profile. Your app receives a real SDK `Session`, the public key and the validated
profile. Only an SDK `Session` authenticates; a pop-up message is only a UI signal.

Version 0.1.0, ready to publish but not on npm yet; [RELEASING.md](RELEASING.md) has the steps.
Once published: `npm install @pubky/passport-client @synonymdev/pubky pubky-app-specs`. The default Passport is `https://passport.pubky.app`. The package has no runtime
dependencies of its own; your app supplies two peers: `@synonymdev/pubky` (0.11 or 0.12) and
`pubky-app-specs` (0.7 or 0.8, loaded only after a sign-in, to validate the profile). The
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

| Attribute      | Default                      | Meaning                                                                                       |
| -------------- | ---------------------------- | --------------------------------------------------------------------------------------------- |
| `instance`     | `https://passport.pubky.app` | The Passport people sign in with (people can pick their own)                                  |
| `app-name`     | the page's host name         | Shown in Passport                                                                             |
| `client-id`    | the page's host name         | A stable ID for the app, part of the request                                                  |
| `capabilities` | `""` (identity only)         | e.g. `/pub/example.app/:rw`; the roots `/`, `/pub`, `/pub/`, `/priv` and `/priv/` are refused |
| `profile`      | `required`                   | `optional` signs in people without a pubky.app profile                                        |
| `variant`      | `small`                      | `large` adds the Pubky Ring QR code and link                                                  |
| `messages`     | English                      | JSON of replacement texts, e.g. `{"label.idle": "Weiter mit Pubky"}`                          |
| `network`      | `mainnet`                    | `testnet` signs in on a Pubky testnet; needs both relays below                                |
| `pkarr-relays` | the SDK's public relays      | Comma-separated PKARR relay URLs (HTTPS, or HTTP on loopback)                                 |
| `http-relay`   | the SDK's public relay       | The HTTP relay inbox of the sign-in request                                                   |
| `sync-group`   | none                         | A name: elements with the same name and settings share one sign-in (see below)                |

Every attribute is optional. Set them before the element joins the page: the first client or
element on a page finishes a same-tab return with the options it has then. Changing `instance`,
`app-name`, `client-id`, `capabilities`, `profile`, `network`, `pkarr-relays` or `http-relay`
starts over; changing `messages` (also a property) only changes the texts. `network="testnet"`
needs both relays (there are no implicit testnet defaults) and a Passport running on the same
testnet; one on the other network refuses the request, and the sign-in fails with the code
`network_mismatch`. The element is a dark pill with the Pubky mark; while a sign-in
runs, a cross in it cancels, and errors and the settings (to pick another Passport, kept for your
origin only) open in a popover below. Signed in, it renders nothing until `reset()`. Its one event,
`passport-session` (bubbling, composed), carries `{ session, publicKey, profile, instance }`.

Several buttons on one page (a hero, a header that appears on scroll, a footer) can share one
sign-in: give each the same `sync-group` name and the same settings (`instance`, `app-name`,
`client-id`, `capabilities`, `profile`, `network`, `pkarr-relays`, `http-relay`; `variant` and
`messages` may differ). They then show one state: a sign-in started, cancelled or retried in one
shows in all, and so does a Passport picked in any one's settings. Removing one (the header
scrolling away) does not end the sign-in; the last one to leave ends it, as removing a single
element does. A completed sign-in fires `passport-session` once for the whole group, on its first
element still on the page, and `reset()` on any of them resets all. An element whose settings
differ from its group's shows "Passport button not configured" and changes nothing in the group.
Groups exist within one page; without `sync-group` every element has its own sign-in.

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
  if (view.signedIn) keep(view.signedIn); // { session, publicKey, profile, instance }
});
button.onclick = () => client.signIn(); // from the click: it opens Passport
```

The options are the attributes' camel-case names (`instance`, `appName`, `clientId`,
`capabilities`, `profile`, `messages`, `network`, `pkarrRelays`, `httpRelay`; `pkarrRelays` also
takes a list). `signIn()` never rejects; it resolves
`{ status: "signed-in", session, publicKey, profile, instance }`, `{ status: "failed", error }` or
`{ status: "redirecting" }` when this tab is going to Passport. Called while a sign-in runs, it
brings Passport forward; while a required profile is missing, it opens Passport's profile page.
`view.signedIn` holds the Session's details from its arrival until `reset()`, however the sign-in
finished; `view.instance` (`{ origin, isCustom }`) is the Passport a sign-in opens now, a custom one
when the person picked it in the settings. `reset()` also cancels a sign-in in progress; `dispose()`
ends the client.

## What your app receives and does

- A real `@synonymdev/pubky` `Session` with the requested capabilities (checked by the package).
  You own it: keep it, use it, and sign it out when you drop it.
- `publicKey` and `profile`, read once after the sign-in and validated by `pubky-app-specs`
  (`name`, and optionally `bio`, `image`, `links`, `status`). With `profile: "required"` it is always
  there; with `"optional"` it is `null` when the person has none or it could not be read. Treat
  `profile.image` (a `pubky://` URL) and `profile.links[].url` as untrusted input.
- `instance`, the origin of the Passport that produced the sign-in. Keep it with the Session and
  send profile edits there, even if the person later picks another Passport.
- `getPassportInstance(defaultInstance?)` (root export) returns the Passport a sign-in from this
  page would open now: the one the person picked in the element's settings for that default, else
  the default, else the public Passport. It is synchronous, reads only this origin's own storage,
  never throws, and ignores a choice that no longer validates; you never need the storage key.
- To let the person edit their profile, link to `${instance}/#edit-profile=${publicKey}` (a new
  tab is fine); the [integration guide](../../docs/integration.md#editing-a-profile) shows it.
- To survive a reload, save the Session with `new Pubky().browserSessionStore.save(session)` and
  `restore(id)` it on start-up. To sign out: `await session.signout()`, then `reset()`.

The [integration guide](../../docs/integration.md#after-sign-in) has the code for all of this. The
[developer demo](https://gillohner.github.io/passport-demo/) (source:
[github.com/gillohner/passport-demo](https://github.com/gillohner/passport-demo)) uses it in a
complete page; it is a developer demo, not an official app.

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
main button, in every state), `::part(settings)` (the settings control, while no sign-in runs),
`::part(cancel)` (the cancel control in the settings' place while a sign-in can be cancelled),
`::part(tray)` (the popover) and `::part(qr)` (the QR code). `cancel` starts from the same styles
as `settings`; to give the pill one look in every state, style `button`, `settings` and `cancel`
together. While Passport commits an approval or finishes, the pill is the `button` alone.
Everything else inside the element is internal and may change.

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
