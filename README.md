# Pubky Passport

Pubky Passport is a web signer for the [Pubky](https://pubky.org) protocol. It keeps a Pubky
identity in the browser and signs in to Pubky apps on its behalf, the way
[Pubky Ring](https://github.com/pubky/pubky-ring) does on a phone. Today there is one way to get an
identity into Passport: **Continue with Google**, and, where it is turned on,
**Continue with Apple**.

Production runs at [passport.pubky.app](https://passport.pubky.app).

## Continue with Google

Signing in with Google creates a Pubky keypair in the browser, registers it with a homeserver and
backs it up to the user's Google Drive. Recovery is a 2-of-2 between Google and Passport: neither
side can recover the key on its own.

- **Only the browser holds the key.** The Pubky secret key is created, encrypted and decrypted in
  the browser and kept in its local storage. Neither Google nor the Passport server ever sees it.
- **Google holds the ciphertext.** The key is encrypted with AES-256-GCM before it leaves the
  browser and stored as `passport.json` in the app-data area of the user's Drive, with a visible
  copy in a "Pubky Passport" folder. Google has no way to decrypt it.
- **Passport holds the wrapping key.** The Passport server derives it with HKDF from its own secret
  and the verified Google account, and hands it out only for a fresh, valid Google ID token. It
  never sees the file, and each file is bound to the Passport origin that created it.

Decryption needs both: Drive access to fetch the file and a Google sign-in to obtain the wrapping
key. On a new device, signing in with the same Google account restores the identity. When there is
no file yet, Passport creates a new identity and backs it up the same way. Afterwards the user can
download an encrypted recovery file, move the key to Pubky Ring, or detach from Google, which
deletes the Drive files and leaves a self-managed identity in the browser.

## Continue with Apple

The same model with Apple: the encrypted key file lives in the user's iCloud private database
(CloudKit) instead of Google Drive. It takes two clicks, because each one opens an Apple window
and browsers only open a window from a click.

1. **Continue with Apple** signs in with Apple and asks for name and email. Like Google's
   profile, they are stored only in the browser; Apple sends the name only the first time. The
   Passport server verifies the Apple ID token and derives the wrapping key from it, as it does
   for Google. The token carries the email; Passport's server verifies it and stores or logs
   none of its claims, and Homegate gets the same token for signup, as with Google. The name
   never leaves the browser.
2. **Connect iCloud** signs in to CloudKit. The CloudKit session stays in the page's memory and
   only goes to Apple's CloudKit API; Passport's server never receives it, so it cannot read the
   file. Apple stores only ciphertext; the wrapping key comes from Passport's server. As with
   Google, the account provider is trusted: it could sign in as the user and get both parts.

No Apple script runs on Passport's pages: both sign-ins are Apple pages in popups that answer
with `postMessage`, and Passport calls the CloudKit web API itself. Neither can be a same-tab
redirect without passing through Passport's server: with the name and email scopes Apple only
returns the result as a `form_post` to the server, and CloudKit's redirect callback puts the
session in the URL's query string. Popups keep both results in the page. There is no browsable copy in
iCloud; users can download a recovery file instead. Apple login is off unless
`APPLE_LOGIN_ENABLED=true` and needs an Apple Developer setup (Services ID, iCloud container,
CloudKit schema and API token), separate for every environment.

## Signing in to apps

Apps open `/authorize` in a popup with a Pubky SDK authorization URL in the fragment. The user
reviews the request, Passport posts the encrypted approval to the relay, and the SDK returns a
`Session`. Passport's own messages only describe the UI outcome. See the
[integration guide](docs/integration.md).

If the person already picked Google or Apple in the app, add `x-provider=google` or
`x-provider=apple` after `d` in the fragment so Passport skips its own choice:

```text
https://passport.pubky.app/authorize#d=pubkyauth%3A%2F%2Fsignin_grant%3F...&x-provider=apple
```

It never changes the request. Identities already in the browser still come first: if exactly one
uses that provider, review shows it for this request, without saving it as the active identity.
Approval stays an explicit click, and any other value is ignored.

## Development

Requires Node 24.18 (see `.nvmrc`) and Corepack, which supplies the pinned pnpm.

```bash
nvm use
corepack enable
pnpm install
cp .env.example .env.local
pnpm dev --experimental-https
```

Create a 32-byte server secret with `openssl rand -base64 32`, set its ID in
`PASSPORT_SERVER_SECRET_CURRENT_KEY_ID` and add it to `PASSPORT_SERVER_SECRET_KEYRING_JSON`.
Register `https://localhost:3000` with the Google OAuth client.

| Variable                                | Purpose                                                    |
| --------------------------------------- | ---------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`                      | Google OAuth web client ID                                 |
| `HOMEGATE_URL`                          | HTTPS Homegate origin that issues homeserver signup tokens |
| `PUBKY_HOMESERVER_CONNECT_ORIGINS`      | Comma-separated HTTPS origins allowed by CSP               |
| `PASSPORT_SERVER_SECRET_CURRENT_KEY_ID` | Key ID used for new Passport file envelopes                |
| `PASSPORT_SERVER_SECRET_KEYRING_JSON`   | JSON map of key IDs to base64 secrets of at least 32 bytes |
| `APPLE_LOGIN_ENABLED`                   | `true` turns Apple login on; then the next four are needed |
| `APPLE_SERVICES_ID`                     | Sign in with Apple Services ID (ID-token audience)         |
| `APPLE_CLOUDKIT_CONTAINER_ID`           | iCloud container, for example `iCloud.app.pubky.passport`  |
| `APPLE_CLOUDKIT_API_TOKEN`              | CloudKit JS API token for that container                   |
| `APPLE_CLOUDKIT_ENVIRONMENT`            | `production` (default) or `development`                    |
| `APPLE_LIVE_CHECK`                      | `true` serves `/dev/apple-live-check`; never in production |

To rotate the server secret, deploy the new key alongside the retained keys, then make its ID
current. Keep an old key for as long as files bearing its ID must remain usable; files contain key
IDs, never secrets.

## Validation

```bash
pnpm check           # format, lint, types, coverage, build
pnpm test:e2e        # production build and Playwright tests
pnpm check:critical  # dependency audit and every check
```

## License

MIT, see [LICENSE](LICENSE).
