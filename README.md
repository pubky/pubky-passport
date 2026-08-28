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

```bash
pnpm check           # format, lint, types, coverage, build
pnpm test:e2e        # production build and browser tests
pnpm check:critical  # dependency audit and every check
```

See [integration](docs/integration.md), [operations](docs/operations.md), and
[security](docs/security.md).
