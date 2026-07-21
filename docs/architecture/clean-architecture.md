# Passport Architecture

## Purpose

Passport is a browser signer that handles Google identity, Drive access, server-derived
wrapping material, and Pubky private keys. The architecture makes runtime and data
boundaries easy to find without introducing a framework-wide abstraction taxonomy.

## Top-Level Structure

```txt
src/
  app/           Next.js routes and route handlers
  ui/            React components and feature UI
  core/          pure feature rules, models, parsers, and flow logic
  adapters/      concrete browser and server integrations
  composition/   browser and server object-graph factories
  libs/          low-level shared utilities and configuration parsing
```

`core` is shared by browser and server code. It is never a browser core or a server
core. Code that needs a runtime belongs under the matching `adapters/browser`,
`adapters/server`, `composition/browser`, or `composition/server` folder.

## Dependency Direction

```txt
Next.js app routes / UI
  -> core feature flow
  -> feature-local dependency contract

composition
  -> core feature flow + concrete adapter
```

Runtime calls flow from a core feature through an injected dependency to an adapter.
Imports point the opposite way: adapters import the feature-local type they satisfy.

For example, the wrapping-key flow uses a verifier, rate limiter, clock, and key
deriver declared in `src/core/identity/dependencies/wrappingKey.ts`. Google and HKDF
adapters implement those types; `src/composition/server/wrappingKeyServerContainer.ts`
selects the concrete instances.

## Feature-Local Dependencies

Dependency contracts are TypeScript types beside the feature that consumes them,
not entries in a global `core/ports` registry.

This keeps the relationship reviewable:

- `core/identity/dependencies/` defines only identity flow capabilities.
- `core/homegate/dependencies.ts` defines only invitation issuance.
- Test fakes and adapters import the feature contract they satisfy.

Add a dependency contract only when a core feature needs an external runtime
capability. Internal helpers and ordinary data transformations do not need one.

## Runtime Boundaries

- Browser adapters and browser composition begin with `import "client-only"`.
- Server adapters and server composition begin with `import "server-only"`.
- Browser code must not import server adapters, server composition, or server env.
- Server code must not import browser adapters, browser composition, or public env.
- `src/core` must not import React, Next.js, adapters, composition, SDKs, runtime
  environment configuration, or browser globals.

The architecture test in `test-utils/architecture/core-boundaries.test.ts` enforces
these rules. ESLint adds the same core import restrictions during local development.

## Security Boundaries

The module layout does not itself secure secrets. These concrete constraints do:

- The browser is the only runtime that may combine Drive ciphertext with the
  Passport wrapping-key API response.
- The Passport server must never receive Drive access tokens, encrypted Drive files,
  or decrypted Pubky key material.
- Google must never receive wrapping material.
- Plaintext Pubky key material and wrapping material remain local variables only;
  they are not logged, returned in UI state, or persisted in browser storage.

Composition is deliberately outside core because it sees both a core flow and the
adapter selected for it. Keep factories short so this sensitive wiring remains easy
to audit.

## Practical Guidance

- Put a pure Pubky auth parser in `core/auth`.
- Put a browser-specific Google/Drive/WebCrypto/Pubky integration in
  `adapters/browser`.
- Put server Google verification, Homegate HTTP, and secret derivation in
  `adapters/server`.
- Put a factory that wires a browser identity flow in `composition/browser`.
- Put a factory that wires an API route in `composition/server`.
- Keep `app/` thin: parse transport input, invoke the composed flow, and construct
  framework responses.
