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
| `PASSPORT_SERVER_SECRET_CURRENT_KEY_ID` | Public ID of the server secret used for newly created Passport files. |
| `PASSPORT_SERVER_SECRET_KEYRING_JSON` | JSON object mapping public key IDs to base64 secrets of at least 32 decoded bytes. It must contain the current ID. |

For local development, generate a secret with `openssl rand -base64 32`, choose a
short ID such as `dev-1`, and use configuration shaped like this:

```dotenv
PASSPORT_SERVER_SECRET_CURRENT_KEY_ID=dev-1
PASSPORT_SERVER_SECRET_KEYRING_JSON={"dev-1":"<base64 secret>"}
```

Each Passport file stores the public key ID, never the secret. To rotate, add a
new entry and make its ID current in the same deployment. Retain old entries only
while their files need to remain decryptable. During development, removing them
is safe if losing old test files is acceptable.

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
