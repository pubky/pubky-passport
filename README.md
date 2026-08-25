# Pubky Passport

Pubky Passport is a browser-based Pubky identity and authorization app. It currently supports Google OAuth.

## Local Development

Requirements: Node.js 24.18.0 LTS and Corepack.

```bash
nvm use
corepack enable
pnpm install
cp .env.example .env.local
```

Configure `.env.local`:

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google OAuth client passed to the browser and used as the server ID-token audience. |
| `HOMEGATE_URL` | CSP-safe HTTPS Homegate base URL passed to the browser. |
| `PUBKY_HOMESERVER_CONNECT_ORIGINS` | Up to 16 comma-separated exact HTTPS homeserver origins allowed by browser CSP. Include origins used by current and returning identities during migrations. This does not select a homeserver. |
| `PASSPORT_SERVER_SECRET_BASE64` | Server secret with at least 32 decoded bytes. Generate one with `openssl rand -base64 32`. |
| `PASSPORT_SERVER_SECRET_CURRENT_KEY_ID` | Optional public ID for the key used by newly created v2 Passport files. |
| `PASSPORT_SERVER_SECRET_KEYRING_JSON` | Optional JSON object mapping key IDs to base64 secrets. It must contain the current ID. Retain old entries while any Passport files reference them. |

`PASSPORT_SERVER_SECRET_BASE64` remains the permanent legacy key for v1 files. Do
not replace it during rotation. To rotate new files, add a new keyring entry and
change `PASSPORT_SERVER_SECRET_CURRENT_KEY_ID`; existing v2 entries must remain in
the keyring until their files have been replaced.

Add `https://localhost:3000` as both an authorized JavaScript origin and an
authorized redirect URI on the Google OAuth web client, then start Next.js with
local HTTPS:

```bash
pnpm run dev --experimental-https
```

Open <https://localhost:3000>. On first run, Next.js uses `mkcert` to create trusted,
ignored certificates under `certificates/` and may ask for permission to trust its
local certificate authority. HTTPS is required by the Google flow and Passport file
origin binding.


Run the full local validation suite with:

```bash
pnpm check
```
