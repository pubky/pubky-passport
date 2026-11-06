# Pubky Passport

Pubky Passport is a web signer for the [Pubky](https://pubky.org) protocol. It keeps a Pubky
identity in the browser and signs in to Pubky apps on its behalf, the way
[Pubky Ring](https://github.com/pubky/pubky-ring) does on a phone. People get an identity into
Passport by signing in with an account they already have: Google, and Apple where it is turned on.

Production runs at [passport.pubky.app](https://passport.pubky.app).

## How it works

### Providers

The sign-in page offers one button per provider that is on: **Continue with Google** always, and
**Continue with Apple** when `APPLE_LOGIN_ENABLED=true`. With Apple on, the page says "Choose an
account to sign in with" above both buttons; with Apple off, Google is the only button and an app
sign-in goes straight to Google. "How?" next to the intro text explains the points below in
short. Apps never choose the provider; the person picks it in Passport.

The provider account only identifies the person and stores an encrypted backup. It does not
create or control the pubky.

### Where the key is made and kept

- **The browser makes the key.** The Pubky secret key is created in the browser, registered with
  a homeserver, and kept in the browser's local storage. Neither the provider nor the Passport
  server ever sees it.
- **The provider stores the ciphertext.** Before the key leaves the browser it is encrypted with
  AES-256-GCM, bound to the Passport origin that created it, and stored with the provider:

  | Provider | Where the encrypted file lives                                                         | Browsable copy                               |
  | -------- | -------------------------------------------------------------------------------------- | -------------------------------------------- |
  | Google   | `passport.json` in the app-data area of the user's Google Drive                        | Optional, in a "Pubky Passport" Drive folder |
  | Apple    | One `PassportFile` record in the user's private iCloud database (CloudKit), per origin | No; download a recovery file instead         |

- **Passport's server holds the wrapping key.** The server derives it with HKDF from its own
  secret and the verified account (`<provider>:<issuer>\n<subject>`) and hands it out only for a
  valid, unexpired ID token from that provider. The browser derives the file's AES key from it.
  The server never sees the file.

### Why each side holds only one part

Unlocking the file needs both parts: the encrypted file, which only the provider account can
fetch, and the wrapping key, which only Passport's server can derive after that account signs in.
The provider has ciphertext without the key; Passport's server has the key material but never the
file, so Passport alone cannot unlock it. The provider is still trusted, as for email: it could
sign in as the user and get both parts.

On a new device, signing in with the same account restores the same identity. When there is no
file yet, Passport creates a new identity and backs it up the same way. Afterwards the user can
download an encrypted recovery file (protected by a password they choose), move the key to Pubky
Ring, or detach from the provider, which deletes the stored file and leaves a self-managed
identity in the browser.

### Google

**Continue with Google** opens Google's sign-in, which also asks for Drive access: the app-data
permission is required, the permission for files Passport creates (the visible copy) is
optional. During an app sign-in Google opens in the same tab and Passport returns to the request
afterwards; on Passport's own pages it opens in a popup. Google's profile (name, email, picture)
is stored only in the browser.

### Apple

Two clicks, because each one opens an Apple window and browsers only open a window from a click:

1. **Continue with Apple** signs in with Apple and asks for name and email. Like Google's
   profile, they are stored only in the browser; Apple sends the name only the first time. The
   Passport server verifies the Apple ID token and derives the wrapping key from it. The token
   carries the email; Passport's server verifies it and stores or logs none of its claims, and
   Homegate gets the same token for signup, as with Google. The name never leaves the browser.
2. **Connect iCloud** signs in to CloudKit. The CloudKit session stays in the page's memory and
   only goes to Apple's CloudKit API; Passport's server never receives it, so it cannot read the
   file.

No Apple script runs on Passport's pages: both sign-ins are Apple pages in popups that answer
with `postMessage`, and Passport calls the CloudKit web API itself. Apple login is off unless
`APPLE_LOGIN_ENABLED=true` and needs an Apple Developer setup (Services ID, iCloud container,
CloudKit schema and API token), separate for every environment. With it off, Passport behaves as
with Google alone.

## Signing in to apps

Apps open `/authorize` in a popup with a Pubky SDK authorization URL in the fragment. The user
reviews the request, Passport posts the encrypted approval to the relay, and the SDK returns a
`Session`. Passport's own messages only describe the UI outcome. See the
[integration guide](docs/integration.md).

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
