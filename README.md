# Pubky Passport

Pubky Passport is a web signer for the [Pubky](https://pubky.org) protocol. It keeps a Pubky
identity in the browser and signs in to Pubky apps on its behalf, the way
[Pubky Ring](https://github.com/pubky/pubky-ring) does on a phone. Today there is one way to get an
identity into Passport: **Continue with Google**.

Production runs at [passport.pubky.app](https://passport.pubky.app).

## Continue with Google

Signing in with Google creates a Pubky keypair in the browser, registers it with a homeserver and
backs it up to the user's Google Drive. Recovery is a 2-of-2 between Google and Passport: neither
side can recover the key on its own.

- **Google holds the ciphertext.** The secret key is encrypted with AES-256-GCM in the browser and
  stored as `passport.json` in the app-data area of the user's Drive, with a visible copy in a
  "Pubky Passport" folder. Google never sees the key that decrypts it.
- **Passport holds the wrapping key.** The Passport server derives it with HKDF from its own secret
  and the verified Google account, and only hands it out for a fresh, valid Google ID token. The
  server never sees the file or the secret key, and each file is bound to the Passport origin that
  created it.

Decryption needs both: Drive access to fetch the file and a Google sign-in to obtain the wrapping
key. On a new device, signing in with the same Google account restores the identity. When there is
no file yet, Passport asks [Homegate](https://github.com/pubky/homegate) for a signup token and
creates a new one. Afterwards the user can download an encrypted recovery file, move the key to
Pubky Ring, or detach from Google, which deletes the Drive files and leaves a self-managed identity
in the browser.

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

To rotate the server secret, deploy the new key alongside the retained keys, then make its ID
current. Keep an old key for as long as files bearing its ID must remain usable; files contain key
IDs, never secrets.

The staging Google client is unpublished, so only `@synonym.to` accounts complete Continue with
Google there. Production accepts any Google account.

## Validation

```bash
pnpm check           # format, lint, types, coverage, build
pnpm test:e2e        # production build and Playwright tests
pnpm check:critical  # dependency audit and every check
```

CI runs the audit, `pnpm check` and the browser tests on every pull request. The live staging
smoke test runs separately with `pnpm test:staging:pubky`. The `Dockerfile` builds the standalone
production image.

## Layout

| Path                  | Purpose                                                       |
| --------------------- | ------------------------------------------------------------- |
| `src/app`             | Next.js routes: `/`, `/authorize` and the wrapping-key API    |
| `src/client/logic`    | Identity lifecycle, Drive storage, crypto, authorization flow |
| `src/client/ui`       | Screens for onboarding, authorization and identity management |
| `src/server`          | Google ID token verification and wrapping-key derivation      |
| `docs/integration.md` | How an app integrates Passport sign-in                        |
| `e2e`                 | Playwright specs                                              |

## License

MIT, see [LICENSE](LICENSE).
