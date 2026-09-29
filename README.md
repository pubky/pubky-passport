# Pubky Passport

Pubky Passport is a web signer for the [Pubky](https://pubky.org) protocol. It keeps Pubky
identities in the browser and signs in to Pubky apps on their behalf, the way
[Pubky Ring](https://github.com/pubky/pubky-ring) does on a phone. An identity gets into Passport
in one of four ways: **Continue with Google**, **Create account** with SMS, Lightning or an invite,
**Import backup** from an encrypted recovery file, or **Connect Pubky Ring** for an identity that
stays in Ring.

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
  never sees the file. Each file records, tamper-proof, the Passport origin that created it; any
  Passport holding the same key can open it.

Decryption needs both: Drive access to fetch the file and a Google sign-in to obtain the wrapping
key. On a new device, signing in with the same Google account restores the identity. When there is
no file yet, Passport creates a new identity and backs it up the same way. A file this origin wrote
but can no longer decrypt can be deleted and replaced; a file from another Passport origin is
reported and never deleted. Afterwards the user can download an encrypted recovery file, add the
key to Pubky Ring, or detach from Google, which deletes the Drive files and leaves a self-managed
identity in the browser.

## Creating an account

**Create account** obtains a homeserver invite through SMS or Lightning verification with Homegate,
or accepts an invite code, which is checked with the homeserver as it is entered. The new key then
lives either in Pubky Ring or in Passport. A Passport key is saved as an unfinished setup until the
user downloads an encrypted backup; leaving before the invite is submitted discards it, and opening
**Create account** again offers any saved setup at the signer choice instead of forcing it.

## Profiles

Identities show their public name and avatar from `/pub/pubky.app/profile.json`; an attached Google
account appears only as a small labelled tag, never as the identity's profile. **Manage identity →
Edit profile** publishes name, bio, links and an optional avatar using `pubky-app-specs` file and
blob records. A new account is asked for its profile once, right after it is created; until
**Finish** publishes one, the overview and Manage offer **Set up profile**. Profile
records are validated and serialized with the `pubky-app-specs` WASM package, pinned to 0.4.4 in
`package.json`.

- **Schema.** Profiles are validated and serialised by the `pubky-app-specs` WASM package, pinned
  exactly at 0.7.0, the release whose models Nexus indexes with. Only
  `src/client/logic/profile/ProfileSpecsAdapter.ts` may import it; ESLint enforces this.
- **Reads.** Passport reads the active identity's profile, and the others only when the identity
  switcher is open, so a visit does not resolve every saved identity at once (which would let PKARR
  relays and shared homeservers link identities kept apart). A sign-in request's identity list
  reads no profile at all: it names each identity from the public name and a 96 px avatar copy
  kept in `localStorage` from that identity's last read, and only the identity chosen for the
  review is read. Avatars are shown
  only from the identity's own `/pub/pubky.app/` files and blobs; remote image URLs are never
  fetched. Every read is bounded in size and time.
- **Avatars.** A chosen image is re-encoded in the browser (at most 512 px) before upload, so
  EXIF data and the local file name are never published.
- **Local keys.** A save signs in with the SDK's root `/:rw` session for that one save and signs
  out, revoking it, on every path. A scoped session would need Passport to approve its own grant
  through the HTTP relay, which adds a network party, and the secret key is already in the browser,
  so a narrower grant would not narrow what this code can do. All input is validated and the
  avatar prepared before signing in.

Ring-held identities are remembered by public key; their private keys stay in Ring. Profile editing
requests a separate write-only grant for `profile.json` plus the `pubky.app` `files/` and `blobs/`
directories (an avatar's blob and file IDs are not known before upload); profiles are read
publicly. The grant is held in memory for the page session and never changes a client's
authorization request. Passport revokes it when it closes the connection inside the page (another
connection replaces it, the identity is removed, or a write is refused). Closing or reloading the
tab does not revoke it: the grant stays valid on the homeserver, and neither Passport nor Ring can
list or revoke it. Whether Ring and the homeserver accept the write-only scopes still needs a device
test. Closing a connection also deletes the SDK's delegated keys from the browser. See
[Adding identities and creating accounts](docs/signup-integration.md#client-contract).

## Signing in to apps

Apps open `/authorize` in a popup with a Pubky SDK authorization URL in the fragment
(`/authorize#d=…`). The user reviews the request, Passport posts the encrypted approval to the
relay, and the SDK returns a `Session`. Passport's own messages only describe the UI outcome. A
request sent to `/#d=…` is forwarded to `/authorize`, and `/authorize` without a request returns to
`/`. See the [integration guide](docs/integration.md).

## Provider configuration

Set `PASSPORT_PROVIDER_CONFIG_JSON` to customize the enabled signup methods, Google availability,
and optional storage/payment descriptions and provider links. Passport shows no provider name. See
[.env.example](.env.example). An invite-only instance can disable Google and omit Homegate and the
server keyring. Invalid combinations, such as `"googleEnabled": true` without `GOOGLE_CLIENT_ID`,
and unknown keys fail startup.

`PUBKY_SIGNUP_HOMESERVER` names the provider's homeserver. It prefills manual invites, limits
storage descriptions and upgrade links to identities on that homeserver, and is the homeserver
**Republish homeserver** points a missing `_pubky` record at when the identity does not remember
the homeserver it signed up on. Storage descriptions are provider-supplied text, not live usage
readings. There is no default homeserver: without the variable, invites ask for a homeserver and
republishing and storage copy stay hidden. Either way, a manual invite can name any homeserver the
person has an invite for.

The signer pages, `/` and `/authorize`, may connect to any HTTPS origin, because an identity lives
on whichever homeserver its key's PKARR record names and an app's request brings its own relay.
Other pages reach only Google, Homegate and the PKARR relays. Earlier releases required
`PUBKY_HOMESERVER_CONNECT_ORIGINS`; Passport no longer reads it. See
[signup integration](docs/signup-integration.md#homeservers-passport-can-reach).

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

| Variable                                | Required                      | Purpose                                                                  |
| --------------------------------------- | ----------------------------- | ------------------------------------------------------------------------ |
| `GOOGLE_CLIENT_ID`                      | With Google                   | Google OAuth web client ID; turns Google on unless the provider says off |
| `HOMEGATE_URL`                          | With Google, SMS or Lightning | HTTPS Homegate origin that issues homeserver signup tokens               |
| `PUBKY_HTTP_RELAY_URL`                  | No                            | HTTP relay for Ring profile grants; defaults to the SDK's relay          |
| `PASSPORT_SERVER_SECRET_CURRENT_KEY_ID` | With Google                   | Key ID used for new Passport file envelopes                              |
| `PASSPORT_SERVER_SECRET_KEYRING_JSON`   | With Google                   | JSON map of key IDs to base64 secrets of at least 32 bytes               |
| `PASSPORT_PROVIDER_CONFIG_JSON`         | No                            | Strict JSON Google switch, signup methods, provider copy and links       |
| `PUBKY_SIGNUP_HOMESERVER`               | No                            | Provider homeserver: invite default, storage gate, republish target      |
| `NEXT_ALLOWED_DEV_ORIGINS`              | No                            | Development only: hosts allowed to reach HMR through a remote proxy      |

To rotate the server secret, deploy the new key alongside the retained keys, then make its ID
current. Keep an old key for as long as files bearing its ID must remain usable; files contain key
IDs, never secrets.

## Validation

```bash
pnpm check           # format, lint, types, coverage, build
pnpm test:e2e        # production build and Playwright tests
pnpm check:critical  # dependency audit and every check
```

Playwright starts a Google and Homegate instance on `PASSPORT_E2E_PORT` (default 3100) and an
invite-only instance without Google, Homegate or a keyring on the next port.
`PASSPORT_E2E_DEV_SERVER=1` runs the specs against `next dev` for local debugging instead: it
relaxes the production caching-header assertions and skips the invite-only instance, so CI refuses
it.

## License

MIT, see [LICENSE](LICENSE).
