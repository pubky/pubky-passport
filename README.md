# Pubky Passport

Pubky Passport is a browser-based Pubky identity and authorization app. The current
implementation covers the core Google-backed custody/recovery strategy and Pubky authorization
flows. The root page is still a development surface; settings, visible-file restore,
and detach flows are not implemented yet.

## Features

- Single-request Google authorization and Google Drive `appDataFolder/passport.json` encrypted Passport file storage.
- Pubky identity creation, homeserver signup, discovery publication, and restore.
- Manual and `/authorize#d=...` Pubky Auth entry points.
- Capability review for v0.10 grant and legacy cookie authentication, SDK-owned
  relay handoff, and validated callback navigation.
- Browser/server boundaries that keep Drive data and Pubky secret material off the
  Passport server.

`appDataFolder/passport.json` remains the only operational Passport file. New
identities also write the encrypted envelope to the user-visible
`Google Drive/Pubky Passport/{pubky}.json` path as a recovery
artifact, without using that copy in normal Passport operations. Repeated backups
create additional same-name Drive files and never overwrite an existing file. If
Passport cannot confirm the visible copy,
the operational identity is not stranded: setup continues and surfaces a warning.
Restore from the visible copy is deferred. Operational app-data access requires `drive.appdata`;
Passport also requests optional `drive.file` access for the best-effort visible copy.
The two locations are handled by separate concrete browser adapters.

The local Pubky identity store intentionally persists the 32-byte Pubky secret unencrypted
in browser localStorage. This accepted custody model lets Passport restore active
identities without repeating the Google Drive flow. Same-origin XSS, malicious
extensions, or shared browser profiles can extract those identities, so no other
plaintext key storage should be added.

See [FLOWS.md](./FLOWS.md) for the runtime call paths and import boundaries.

## Integration

See [INTEGRATION.md](./INTEGRATION.md) for the web app integration flow.

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

Add `https://localhost:3000` as an authorized JavaScript origin and
`https://localhost:3000/google-oauth-callback` as an authorized redirect URI on
the Google OAuth web client, then start Next.js with local HTTPS:

```bash
pnpm run dev --experimental-https
```

Open <https://localhost:3000>. On first run, Next.js uses `mkcert` to create trusted,
ignored certificates under `certificates/` and may ask for permission to trust its
local certificate authority. HTTPS is required by the Google flow and Passport file
origin binding.

When upgrading an existing deployment, rename the old `NEXT_PUBLIC_*` variables and
confirm its previous Passport public URL exactly matched the browser origin serving
the app. Existing `passport.json` files are authenticated to that origin; changing
their `url` field does not migrate them and will make decryption fail.

Run the full local validation suite with:

```bash
pnpm check
```
