# Pubky Passport

Browser-based Pubky identity recovery and authorization, backed by Google Drive.

## Development

Requires Node 24.18 and Corepack.

```bash
nvm use
corepack enable
pnpm install
cp .env.example .env.local
pnpm dev --experimental-https
```

Create a 32-byte server secret with `openssl rand -base64 32`. Set its public ID in
`PASSPORT_SERVER_SECRET_CURRENT_KEY_ID` and add it to
`PASSPORT_SERVER_SECRET_KEYRING_JSON`. Register `https://localhost:3000` with the
Google OAuth client.

## Deployment

| Variable                                | Purpose                                                    |
| --------------------------------------- | ---------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`                      | Google OAuth web client ID                                 |
| `HOMEGATE_URL`                          | HTTPS Homegate origin                                      |
| `PUBKY_HOMESERVER_CONNECT_ORIGINS`      | Comma-separated HTTPS origins allowed by CSP               |
| `PASSPORT_SERVER_SECRET_CURRENT_KEY_ID` | Key ID used for new recovery-file envelopes                |
| `PASSPORT_SERVER_SECRET_KEYRING_JSON`   | JSON map of key IDs to base64 secrets of at least 32 bytes |

To rotate the server secret, deploy the new key alongside the retained keys, then make its ID
current. Keep an old key for as long as recovery files bearing its ID must remain usable. Recovery
files contain key IDs, never server secrets.

## Validation

```bash
pnpm check           # format, lint, types, coverage, build
pnpm test:e2e        # production build and browser tests
pnpm check:critical  # dependency audit and every check
```

CI should run `pnpm check:critical`. Live-provider staging tests stay separate and run with
`pnpm test:staging:pubky`.

See the [integration guide](docs/integration.md) to connect another application to Passport.
