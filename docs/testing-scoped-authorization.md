# Testing Google sign-in and scoped encryption consent

Use a test Google account and keep the Passport origin, Google client ID, and server keyring
unchanged between creation and recovery. The encrypted Drive backup needs the same wrapping
secret that created it. A new preview keyring does not recover a production backup.

## Automated checks

From the Passport checkout:

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run src/client/logic/pubky/scopedEncryptionApproval.test.ts
pnpm test:e2e
```

The SDK tests use real signing, HPKE encryption/decryption, approval signatures, scope checking,
and tamper/downgrade rejection. Fetch is intercepted; a deliberate PKARR 404 stops the exchange
after verification. They do not establish a live homeserver session.

Selective approval uses the SDK's single `approveAuthRequest(url)` entry point.
Passport removes declined `e` actions from the validated URL before that call,
preserving `r`/`w`, the requesting app identity, and the signed-approval transport.
The official `@synonymdev/pubky` `0.16.0` SDK derives keys only for the remaining
`e` scopes, and its recipient checks the result against the original request.
See [the SDK contract and upstream source references](integration.md#scoped-encryption-consent).
These checks exercise that released SDK; older versions do not support this protocol.

The browser suite tests review, Google redirect continuation, and SDK relay delivery
in Chromium, Firefox, WebKit, and mobile Chromium. Google, Drive, Homegate, and relay responses
are fixtures. To rerun just the encryption approval cases after building:

```sh
pnpm test:e2e:run --workers=4 --grep "HPKE signed approval"
```

These checks have been run. Real Google consent, Drive recovery, a live `e`-capable homeserver
exchange, and Shop purchase completion still require the manual checks below.

## Run Passport and the current Shop locally

Configure Passport's `.env.local` from [.env.example](../.env.example): use your registered
`GOOGLE_CLIENT_ID`, a persistent `PASSPORT_SERVER_SECRET_CURRENT_KEY_ID`, and its persistent
`PASSPORT_SERVER_SECRET_KEYRING_JSON`. Keep secrets in that ignored file.

Register **`https://localhost:3000`** as both an authorized JavaScript origin and redirect URI for
that Google OAuth web client. Passport uses `location.origin` as its root callback; the redirect
URI is not `/authorize` or the Shop's origin. A preview hostname requires its own exact Google
registration. Trust the local HTTPS certificate in the browser before starting sign-in.

In the Passport checkout:

```sh
HOMEGATE_URL=https://homegate.staging.pubky.app \
PUBKY_HOMESERVER_CONNECT_ORIGINS=https://homeserver.staging.pubky.app \
pnpm dev --experimental-https --port 3000
```

In a separate terminal in a Shop checkout with dependencies installed:

```sh
PUBKY_RUNTIME_ENV=staging \
PUBKY_RUNTIME_PASSPORT_URL=https://localhost:3000 \
PUBKY_RUNTIME_HOMEGATE_URL=https://homegate.staging.pubky.app \
PUBKY_RUNTIME_HOMESERVER=ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy \
PUBKY_RUNTIME_HOMESERVER_URL=https://homeserver.staging.pubky.app \
PUBKY_RUNTIME_DEFAULT_HTTP_RELAY=https://httprelay.staging.pubky.app/inbox \
npm run dev:https -- --port 3001
```

Open `https://localhost:3001`. This was checked against Shop `shop-v0.6.51`; its Passport URL
override is a server environment variable, not a query-string or localStorage setting. Start
from staging development configuration; align any other overridden network values with staging.
The team-reported staging Homegate setup restricts new Google signup to eligible accounts
(`@synonym.to`); confirm the account is allowed or use an authorized test issuer/fixture.

The current Shop requests storage access without `e`. Use it to check compatibility and Google
recovery. Use the separate scoped-key harness below to test the new permission.
Local Shop defaults do not enable durable commerce: a purchase test also needs its configured
transaction service/BFF, accepted frontend origin, service keys, and database. Starting these
two frontends does not establish that purchases work.

## Google recovery and consent

1. Start in a fresh browser profile and choose Shop's Passport sign-in. Google must open in the
   same Passport window. After Google/Drive setup, review must name the original requester and
   wait for **Authorize**.
2. Complete sign-in and record only the public Pubky. Repeat with another fresh profile and the
   same Google account against the same Passport origin/keyring. Confirm the same Pubky returns.
3. In the scoped-key harness below, uncheck chat encryption, choose **Switch**, and select another
   local identity or return with Back. The chat choice must remain unchecked. Approve and confirm
   the returned grant keeps chat storage access without a chat key.
4. Check Google denial, Passport cancellation, and popup closure. Shop must leave its pending
   state without signing in.

## Check actual key delivery and encryption

A complete check needs a signing identity registered on a homeserver containing
[pubky-homeserver #668](https://github.com/pubky/pubky-homeserver/pull/668), included in the `0.16.0`
release. Confirm the deployed homeserver version or commit; upgrading Passport alone cannot
make an older homeserver accept `e`. The app must also use `@synonymdev/pubky` `0.16.0`, pinned
by this checkout, rather than the older SDK currently used by Shop.

The [manual harness](manual-scoped-key-test.js) generates its own `af=v1` / `epk` request and
waits for an actual SDK `Session`. It checks approved capabilities and key scopes, derives
non-extractable AES-GCM keys, encrypts/decrypts with a fresh IV and path-bound associated data,
and verifies that a different path's key cannot decrypt the ciphertext. Declined scopes must
reject key derivation. It writes no files to the homeserver and returns only metadata.

To run without adding a route to Passport, create a temporary browser harness:

```sh
mkdir -p /tmp/passport-scoped-test
cp node_modules/@synonymdev/pubky/index.js /tmp/passport-scoped-test/pubky-sdk.js
cp docs/manual-scoped-key-test.js /tmp/passport-scoped-test/
```

Save the following as `/tmp/passport-scoped-test/index.html`:

```html
<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Passport scoped-key check</title>
<button data-mode="all">Approve both keys</button>
<button data-mode="notes">Approve only notes</button>
<button data-mode="none">Decline both keys</button>
<pre id="result"></pre>
<script type="importmap">
  { "imports": { "@synonymdev/pubky": "./pubky-sdk.js" } }
</script>
<script type="module">
  import { testScopedPassport } from "./manual-scoped-key-test.js";
  const buttons = [...document.querySelectorAll("button")];
  const result = document.querySelector("#result");
  for (const button of buttons) {
    button.onclick = async () => {
      buttons.forEach((item) => (item.disabled = true));
      result.textContent = "Complete the selected consent choices in Passport.";
      try {
        const checked = await testScopedPassport("https://localhost:3000", button.dataset.mode);
        result.textContent = JSON.stringify(checked, null, 2);
      } catch (error) {
        result.textContent = error.message;
      } finally {
        buttons.forEach((item) => (item.disabled = false));
      }
    };
  }
</script>
```

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory /tmp/passport-scoped-test
```

Open `http://localhost:4173` and run the three cases, selecting the indicated checkboxes inside
Passport. For a remote workstation, tunnel these localhost ports to your browser first; Google
registration must match the origin visible in that browser. Replace the Passport origin in the
HTML if using an HTTPS preview. The harness uses the staging HTTPS relay.

| Case    | Chat encryption | Notes encryption | Approved capabilities | Key scopes / round trips |
| ------- | --------------- | ---------------- | --------------------- | ------------------------ |
| Both    | Checked         | Checked          | chat `rwe`, notes `e` | chat + notes / 2         |
| Notes   | Unchecked       | Checked          | chat `rw`, notes `e`  | notes / 1                |
| Neither | Unchecked       | Unchecked        | chat `rw`             | empty bundle / 0         |

The concrete directories are `/priv/chat/v1/` and `/priv/notes/v1/`. An empty bundle must still
exist; `undefined` would mean a bare grant instead of the required signed approval. The helper
releases its SDK handles but does not revoke grants or previously delivered keys. A fresh flow
with declined `e` cannot revoke keys delivered by an earlier approval.

An approval reaching the relay or Passport showing completion does not prove app authentication;
the SDK must return a `Session`. A homeserver discovery error means this final exchange did not
finish. Relay HTTP 413 can leave the app waiting: keep these short scopes, or configure an
adequate relay body limit. Do not log authorization URLs, pending flow exports, raw keys, or
session secret exports.

Running the upstream local testnet alone is insufficient: the identity must be registered there,
the requesting SDK must use its PKARR network, and Passport needs an accepted HTTPS relay.
The full manual harness has not been run against an upgraded live homeserver in this change.
