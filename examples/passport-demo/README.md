Derived from pubky/pubky-app-templates@471735d basic-pubky-app (MIT)

This workspace import uses SDK 0.11.0 and TypeScript 6.0.3. Run
`pnpm --filter passport-demo dev`, `pnpm --filter passport-demo build`, or
`pnpm --filter passport-demo test --run` from the workspace root. The template's
GitHub configuration and npm lockfile are excluded. Its auth UI is temporary;
the demo will move to the Passport client. SDK lifetime fixes are covered
by regression tests, including cancellation and late approvals.

`qrcode` is a transitional demo-only dependency from the upstream template, covered
by `pnpm audit --prod`; it goes away when the demo moves to the Passport client.

The original upstream reference follows; its installation commands, SDK 0.12
notes and hosted builds describe the upstream template.

[![Pubky](https://img.shields.io/badge/Pubky-0.12.0-blue)](https://www.npmjs.com/package/@synonymdev/pubky/v/0.12.0)

# Basic Pubky App

A minimal Vite + TypeScript starter for standalone Pubky apps that use Homeservers directly as their data layer—without indexers, aggregators, or integration with pubky.app’s social data.

This template focuses on Pubky’s core building blocks. The included vanilla HTML, TypeScript, and CSS are deliberately kept simple and exist only to demonstrate those features; the template does not prescribe a UI framework, frontend architecture, or styling system.

## What's Included

- Grant-based Pubky Ring sign-in with a QR code, authorization link, and copy-to-clipboard action.
- A development-only authentication shortcut that removes sign-in friction on a local testnet. It requires `signup_mode = "open"` and is not intended as a pattern for production apps.
- Session persistence across page reloads via the SDK browser session store, plus sign out.
- File storage helpers under a configured path on the user’s Homeserver.
- A live event stream subscription scoped to the configured path.
- Preconfigured weekly Dependabot updates for all npm dependencies, with Pubky stack packages grouped together.

## What's Not Included

- Identity key and recovery phrase management. Pubky apps should delegate these responsibilities to a dedicated identity manager such as Pubky Ring, keeping keypairs outside the app.
- Homeserver admin tools.
- An aggregator or indexer. This template talks directly to the user’s Homeserver and does not provide cross-Homeserver aggregation or data indexing.

## Quick Start

Requires Node.js 20.19+ or 22.12+.

```bash
npx tiged pubky/pubky-app-templates/basic-pubky-app my-pubky-app
cd my-pubky-app
npm install
npm run dev
```

Local testnet is the default. Set `VITE_PUBKY_TESTNET=false` to use mainnet.

Use **Sign in with [Pubky Ring](https://pubkyring.app/)** to authorize an app session. For local
testnet development, the [Pubky Ring Simulator](https://simulator.pubkyring.app) can
approve sign-in requests. With `vite dev` on testnet, **New identity** provides a
development auth shortcut; the homeserver must run with `signup_mode = "open"`.

For complete local Homeserver, testnet, and authentication setup, follow the [Pubky Developer Guide](https://pubky.org/explore/pubkycore/getting-started/).

The hosted GitHub Pages builds are available for
[mainnet](https://pubky.github.io/pubky-app-templates/mainnet/basic-pubky-app/) and a
[local testnet](https://pubky.github.io/pubky-app-templates/testnet/basic-pubky-app/). Both are
production builds and expose only Pubky Ring sign-in.

## App Settings

App-specific configuration lives in `src/config.ts`:

```ts
export const APP_CLIENT_ID = "template";
export const APP_PATH = `/pub/${APP_CLIENT_ID}/`;
export const APP_CAPABILITIES = `${APP_PATH}:rw`;
```

Change `APP_CLIENT_ID` first when starting a real app; the path and capabilities are derived from it. The file also centralizes testnet and relay settings.

With [Pubky SDK 0.12.0](https://github.com/pubky/pubky-homeserver/releases/tag/v0.12.0),
keep session storage paths such as `/pub/template/files/` unchanged. The SDK handles
the new `/storage/{user}/...` transport routes and falls back to legacy addressing
when the homeserver does not advertise support. Directory listings still return
`pubky://...` resource URLs; they are not transport URLs. See the versioned
[storage routing source](https://github.com/pubky/pubky-homeserver/blob/v0.12.0/pubky-sdk/src/client/http_targets/storage.rs).

Set `VITE_PUBKY_STORAGE_NAMESPACE` when multiple builds share an origin and should keep their saved
sessions separate.
