# Changelog

## 0.1.0

First release.

- `<pubky-passport>` element (`@pubky/passport-client/element`): a "Continue with Pubky" button
  that opens Pubky Passport and fires `passport-session` with the SDK `Session`, the public key and
  the validated pubky.app profile. Attributes: `instance`, `app-name`, `client-id`, `capabilities`,
  `profile` (`required` by default, or `optional`), `variant` (`small` or `large`) and `messages`.
- The large style adds a Pubky Ring QR code with Ring's logo: pressing it copies the
  `pubkyauth://` link it encodes, an expired code reloads on click, and phones get an "Open in
  Pubky Ring" link.
- `network` (`mainnet` by default, or `testnet`), `pkarrRelays` and `httpRelay` (attributes
  `network`, `pkarr-relays`, `http-relay`): the client builds its own SDK client on those relays
  and names its network to Passport, which refuses the other network with `network_mismatch`.
- Capabilities follow least privilege: the roots `/`, `/pub`, `/pub/`, `/priv` and `/priv/` are
  refused; any folder below them, such as `/priv/example.app/`, is allowed.
- Headless `createPassportClient(options)` for your own button: `signIn()`, `describe()`,
  `subscribe()`, `reset()` and `dispose()`.
- Passport opens in a pop-up bound to the exact request (opener protocol v2). It continues in the
  same tab when the pop-up is blocked, and in in-app browsers, iOS home-screen apps and
  cross-origin-isolated pages, where pop-ups can't work.
- With `profile="required"`, the Session is handed over only once the person has a pubky.app
  profile, created inside Passport (also after a Pubky Ring sign-in, and after a closed window).
- People can pick another Passport instance from the button's settings; the choice is kept per app.
  `SignedIn.instance` names the Passport that produced a sign-in, `view.instance` the one a sign-in
  opens now, and `getPassportInstance(defaultInstance?)` reads the person's choice without a client.
- Styling: the `::part`s `button`, `settings`, `cancel`, `tray` and `qr`, and nine
  `--passport-*` CSS properties.
- `sync-group`: elements with the same name and settings share one sign-in, cancel, retry and
  Passport choice; the group fires `passport-session` once, on its first element still on the
  page, and keeps going while any member remains.
  Every text can be replaced through `messages`.
- Entries: `entry="join" | "google" | "sign-in"` (element) and `signIn({ entry })` (headless) open
  Passport on its Join screen, its Google sign-in or its Sign in screen; an entry button is named
  after its screen ("Join Pubky", "Continue with Google", "Sign in with Pubky").
- Classic QR: a per-device switch under the large style's code ("Older Pubky Ring? Classic QR") and `setClassicQr(on)` / `view.classicQr` make the client's requests the legacy
  cookie sign-in for Pubky Ring before 2.0; off by default. `SignedIn.session` is then a cookie
  Session; the same-tab continuation is not offered for it.
- The large style names both keychains: "or scan with Pubky Ring or Bitkit", "Open keychain app".
- While the client holds a prepared keychain request (the large element's code or its "Open
  keychain app" button), its hello carries the `keychain` feature, and a request's Join in Passport
  leaves out its own "Use Pubky Ring or Bitkit". A display hint; it grants nothing.
- `entry="google"` shows Google's "G" in the pill (the Pubky mark otherwise), published as
  `::part(icon)`; a `slot="help"` child sits inside the pill beside the button (the app's "?");
  with an entry, an app's own `label.idle` stays the label unless it also sets `label.<entry>`.
- No runtime dependencies. Peers: `@synonymdev/pubky` `>=0.11.0 <0.13.0` and `pubky-app-specs`
  `>=0.7.0 <0.9.0`.
