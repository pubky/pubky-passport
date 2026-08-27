# Runtime Flows

This document describes security boundaries and externally meaningful behavior.
Function names and internal call graphs belong in the code and tests.

## Boundaries

- `src/app` contains Next.js pages and route handlers. Browser fragments never
  reach the server.
- `src/client/ui` renders safe view models and sends user intent to browser
  logic. OAuth tokens, Pubky Auth secrets, private keys, and wrapping keys must
  not enter React state.
- `src/client/logic` owns browser storage, WebCrypto, Google Drive, OAuth popup,
  and Pubky SDK integration. The Pubky SDK is imported only by its concrete
  adapter.
- `src/server` validates Google ID tokens and derives wrapping keys. Server
  secrets and derived keys never enter logs or persisted server state.
- `src/libs` contains contracts and helpers shared across a deliberate browser
  or server boundary.

`client-only`, `server-only`, and ESLint rules enforce the runtime import lanes.

## Routes

| Route | Responsibility |
| --- | --- |
| `/` | Select, create, inspect, back up, migrate, or detach a local identity. |
| `/authorize` | Capture, review, approve, or cancel a Pubky Auth request. |
| `POST /api/wrapping-key/google` | Verify a Google ID token and derive the requested wrapping key. |

## Authorization

1. A relying app opens `/authorize#d=…`. The fragment contains the sensitive
   Pubky Auth request and is unavailable to the server.
2. Pre-hydration browser code captures the value and immediately removes the
   fragment from the address bar and history entry.
3. The request parser validates its protocol, capabilities, relay, secret, and
   callbacks. Only a safe review projection may be rendered.
4. Approval restores the identity selected during review, verifies the restored
   public key, and gives the SDK adapter only the validated authorization URL.
5. The request and callbacks are consumed once. Opaque SDK handles are freed on
   success and failure.
6. Completion first sends an origin-bound message to a live opener and waits for
   a compatible acknowledgement. It otherwise navigates to the validated HTTPS
   callback. If neither is possible, Passport shows a local terminal state.

Manual entry performs the same validation, then starts a fresh `/authorize`
document so parser-time capture and CSP apply identically.

## Google-backed identity

One screen-scoped operation owns OAuth cancellation, network cancellation, and
Pubky key handles.

### Restore or create

1. Passport obtains short-lived Google ID and Drive access tokens and binds the
   UserInfo subject to the ID-token subject.
2. It reads the single operational Passport file from Drive `appDataFolder`.
3. If a file exists, Passport requests the wrapping key named by the envelope,
   decrypts exactly one Pubky secret key, restores it, verifies its public key,
   signs in, and saves it locally.
4. If no file exists, Passport requests the current wrapping key and a Homegate
   invitation, creates a Pubky identity, encrypts its secret, and atomically
   creates the Drive file before homeserver activation.
5. A visible recovery copy is best-effort. Failure is shown as a warning and does
   not invalidate the authoritative `appDataFolder` copy.
6. If activation was interrupted, restoration may reconcile signup, PKDNS
   publication, and sign-in before saving locally.

A structurally invalid Drive file is never decrypted. Replacement requires an
explicit destructive confirmation and deletes only the confirmed invalid file
before retrying normal establishment.

### Detach

1. Passport requires the Google subject recorded on the selected identity and
   reauthorizes that exact account.
2. It decrypts the operational Drive file, when present, and verifies that its
   Pubky matches the selected local identity.
3. It deletes matching visible recovery copies and the operational file.
4. Only after Drive cleanup succeeds does it remove the local identity. A Drive
   failure leaves the local copy intact.

Local-only identities do not expose this action.

## Wrapping-key rotation

- Every envelope carries a public, non-secret key ID. New files use
  `PASSPORT_SERVER_SECRET_CURRENT_KEY_ID`; existing files request the ID they
  contain. The server resolves both through `PASSPORT_SERVER_SECRET_KEYRING_JSON`.
- The key ID and origin are authenticated with the ciphertext. Removing a keyring
  entry makes files that reference it undecryptable.
- The API verifies token audience, issuer, subject, time claims, and replay
  limits before deriving a key. Traffic limiting is an infrastructure concern,
  not a process-local guarantee.

## Persistent identity catalog

Each identity is stored under its own local-storage key and the active public key
is stored separately. Mutations therefore do not rewrite an entire shared array.
The UI subscribes to same-tab mutations and browser `storage` events. Display
forms such as `pubky<z32>` and recovery filenames are derived from the canonical
`publicKeyZ32` and are not persisted.

## Invariants

- Secret-key byte buffers are cleared after import, export, encryption, and
  persistence attempts.
- AES-GCM envelopes use canonical base64url, a 12-byte IV, and ciphertext long
  enough to contain the 16-byte authentication tag.
- Drive operations preserve revision, pagination, file-ID, and bounded-size
  checks.
- Unexpected exceptions are classified and logged once at a use-case boundary;
  logs and UI state contain no token, callback, request, key, or passphrase.
- A failed or cancelled operation cannot update an unmounted screen or initiate
  a late recovery-file download.
