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
- Headless `createPassportClient(options)` for your own button: `signIn()`, `describe()`,
  `subscribe()`, `reset()` and `dispose()`.
- Passport opens in a pop-up bound to the exact request (opener protocol v2). It continues in the
  same tab when the pop-up is blocked, and in in-app browsers, iOS home-screen apps and
  cross-origin-isolated pages, where pop-ups can't work.
- With `profile="required"`, the Session is handed over only once the person has a pubky.app
  profile, created inside Passport (also after a Pubky Ring sign-in, and after a closed window).
- People can pick another Passport instance from the button's settings; the choice is kept per app.
- Styling: the `::part`s `button`, `settings`, `tray` and `qr`, and nine `--passport-*` CSS
  properties.
  Every text can be replaced through `messages`.
- No runtime dependencies. Peers: `@synonymdev/pubky` `>=0.11.0 <0.13.0` and `pubky-app-specs`
  `>=0.7.0 <0.8.0`.
