# Repository Layout

Passport uses a small layer-first layout with feature-local core code. It keeps
Next.js, browser APIs, server APIs, and sensitive key-handling integrations visible
without forcing every feature through a global technical-layer taxonomy.

```txt
src/
  app/                         Next.js routes and route handlers
  ui/                          React components and feature UI
  core/
    auth/                      Pure Pubky auth parsing and validation
    homegate/                  Invitation flow and its dependency contract
    identity/                  Identity models, flow rules, and dependencies
    passport-file/             Encrypted envelope model and parser
  adapters/
    browser/                   Drive, WebCrypto, Pubky SDK, Passport API clients
    server/                    Google verification, Homegate HTTP, secret derivation
  composition/
    browser/                   Browser feature factories
    server/                    Server route factories
  libs/                        Shared utilities and environment parsing
```

## Core Features

Each core folder owns pure rules and the contracts for external behavior it needs.
For example, `core/identity/dependencies/passportFile.ts` describes encrypted file
storage and crypto without knowing Google Drive or WebCrypto. Concrete browser
adapters and test fakes import that type.

Do not add a global `core/ports` directory. If a type is needed by only one feature,
place it in that feature's `dependencies/` folder or dependency module. If it is a
pure model or parser, keep it with the feature directly.

## Adapters

`adapters/browser` and `adapters/server` are runtime boundaries, not generic
utility folders.

- Browser production modules start with `import "client-only"`.
- Server production modules start with `import "server-only"`.
- Browser adapters never import server adapters or server env.
- Server adapters never import browser adapters or public env.
- Concrete Pubky SDK imports stay in `adapters/browser/pubky`.

## Composition

Composition selects concrete adapters and passes them to a core feature flow. It is
not an adapter and does not belong inside `adapters`.

- `composition/browser` is client-only and creates browser feature object graphs.
- `composition/server` is server-only and creates server route object graphs.
- Composition should remain short, stateless, and free of business rules.

## App And UI

`app/` translates Next.js transport concerns into feature calls. `ui/` renders safe
state and imports browser composition only from client components. Neither layer may
import server adapters, server composition, or server environment configuration into
browser-capable code.

## Security Review

The architecture test enforces core isolation, browser/server runtime separation,
runtime marker imports, Pubky SDK confinement, and server environment import rules.
It complements, but does not replace, review of the actual split-secret data flow:
Drive data and wrapping material meet only in browser memory.
