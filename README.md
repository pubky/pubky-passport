# Pubky Passport

Pubky Passport is a browser-based Pubky identity and authorization app. The current
implementation covers the core Google-backed identity and Pubky authorization
flows. The root page is still a development surface; settings, backup, and detach
flows are not implemented yet.

## Features

- Google sign-in and Google Drive `appDataFolder` key storage.
- Pubky identity creation, homeserver signup, discovery publication, and restore.
- Manual and `/authorize?d=...` Pubky Auth entry points.
- Capability review, SDK-owned relay handoff, and validated callback navigation.
- Browser/server boundaries that keep Drive data and Pubky secret material off the
  Passport server.

The local identity store intentionally persists the 32-byte Pubky secret unencrypted
in browser localStorage. This accepted custody model lets Passport restore active
identities without repeating the Google Drive flow. Same-origin XSS, malicious
extensions, or shared browser profiles can extract those identities, so no other
plaintext key storage should be added.

See [FLOWS.md](./FLOWS.md) for the runtime call paths and import boundaries.

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
| `PASSPORT_SERVER_SECRET_BASE64` | Server secret with at least 32 decoded bytes. Generate one with `openssl rand -base64 32`. |

Add `https://localhost:3000` as an authorized JavaScript origin on the Google OAuth
client, then start Next.js with local HTTPS:

```bash
pnpm run dev --experimental-https
```

Open <https://localhost:3000>. On first run, Next.js uses `mkcert` to create trusted,
ignored certificates under `certificates/` and may ask for permission to trust its
local certificate authority. HTTPS is required by the Google flow and Passport-file
origin binding.

When upgrading an existing deployment, rename the old `NEXT_PUBLIC_*` variables and
confirm its previous Passport public URL exactly matched the browser origin serving
the app. Existing `passport.json` files are authenticated to that origin; changing
their `url` field does not migrate them and will make decryption fail.

Run the full local validation suite with:

```bash
pnpm check
```
