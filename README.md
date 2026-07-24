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

The interim local identity repository stores the 32-byte Pubky secret unencrypted
in browser localStorage. This must be replaced before treating the app as a
production signer.

See [FLOWS.md](./FLOWS.md) for the runtime call paths and import boundaries.

## Local Development

Requirements: Node.js 22 and Corepack.

```bash
corepack enable
pnpm install
cp .env.example .env.local
```

Configure `.env.local`:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_PASSPORT_PUBLIC_URL` | Passport origin. Keep `https://localhost:3000` for local development. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth client used by the browser. |
| `NEXT_PUBLIC_HOMEGATE_URL` | CSP-safe HTTPS Homegate base URL used directly by the browser. |
| `GOOGLE_CLIENT_ID` | Expected Google ID-token audience. Use the same OAuth client ID. |
| `PASSPORT_SERVER_SECRET_BASE64` | Server secret with at least 32 decoded bytes. Generate one with `openssl rand -base64 32`. |

Add `https://localhost:3000` as an authorized JavaScript origin on the Google OAuth
client, then start Next.js with local HTTPS:

```bash
pnpm run dev --experimental-https
```

Open <https://localhost:3000>. On first run, Next.js uses `mkcert` to create trusted,
ignored certificates under `certificates/` and may ask for permission to trust its
local certificate authority. HTTPS is required by the Google flow and by Passport's
public URL validation.

Run the full local validation suite with:

```bash
pnpm check
```
