# Passport demo

A small app that signs people in with `@pubky/passport-client` and then uses their Pubky
homeserver. Derived from pubky/pubky-app-templates@471735d basic-pubky-app (MIT, see LICENSE).

## What it shows

- **Demo tab**: the playground puts one `<pubky-passport>` on its own stage beside the settings
  that shape it (Passport URL, small or large style with the Pubky Ring QR, profile required or
  optional) and the matching snippet. **Styles** below shows more looks, each live with its code:
  your own button and a text link on the headless client (`createPassportClient`, `subscribe()`,
  `signIn()`), the simple tag, the large style, your own words (`messages`), your own colours and
  size (CSS custom properties), and a combination. A small button also sits in the header.
- **Use it in your app tab**: the one snippet an app starts from, with links to the integration
  guide, the package README and `src/passport.ts`.
- **Signed in**: the person's name from their pubky.app profile, their public key, and a files panel
  that writes to `/pub/passport-demo/files/` on their homeserver with the SDK Session. A reload
  keeps them signed in; Sign out revokes the Session.

## Where the integration is

What an app copies is [`src/passport.ts`](src/passport.ts): the element's `passport-session`
listener, keeping the Session with the SDK's session store, restoring it on load, and signing out.
The playground's own machinery is elsewhere: its settings and the element's attributes
(`src/settings.ts`, `src/config.ts`), and taking one Session when several buttons share a page
(`firstSignIn` in `src/settings.ts`). The rest is page UI (`src/app.ts`, `src/styles.ts` for the
gallery, `src/explainer.ts`, `src/dom.ts`, `src/style.css`) and the files panel (`src/files.ts`,
`src/storage.ts`).

## Run it

From the repository root:

```bash
pnpm install
pnpm --filter @pubky/passport-client build
cd examples/passport-demo
pnpm exec vite --host 0.0.0.0 --port 5173
```

Without `VITE_PASSPORT_URL` the demo signs in with the package's own Passport
(https://passport.pubky.app); set it to use another one. Behind an HTTPS port forward, add
`VITE_HMR_CLIENT_PORT=443` and list the forward's host names in `DEMO_ALLOWED_HOSTS`
(comma-separated; `.example.com` allows its subdomains). `VITE_APP_NAME`, `VITE_CLIENT_ID`,
`VITE_CAPABILITIES` and `VITE_STORAGE_NAMESPACE` change the app's identity. The dependencies are the
package and its two peers, `@synonymdev/pubky` and `pubky-app-specs`.
