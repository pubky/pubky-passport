# Clean Architecture

## Goal

The codebase must follow clean architecture principles in Next.js.

The architecture must prevent UI, framework, Google, Drive, Pubky SDK, crypto, and network logic from leaking into domain/application logic.

## Dependency direction

```txt
src/app
  -> src/ui
    -> src/core/controllers
      -> src/core/application
        -> src/core/domain
        -> src/core/ports

src/infrastructure
  -> src/core/ports
  -> src/core/domain where needed
```

Dependencies point inward.

Domain and application layers define what the app does.

Infrastructure defines how external systems are used.

## Feature organization

Passport uses a hybrid organization:

```txt
Layer-first for dependency and runtime boundaries.
Feature-namespaced inside layers for ownership and navigation.
```

Keep the top-level layers separate:

- `src/app` for Next.js routes and route handlers.
- `src/ui` for React screens and components.
- `src/core` for framework-independent controllers, use cases, domain rules, pipes, ports, and UI-safe state.
- `src/infrastructure` for concrete browser and server adapters.
- `src/libs` for shared runtime-independent utilities and explicitly separated environment modules.

Feature locality is represented by matching names inside these layers, for example:

```txt
src/app/authorize
src/ui/features/authorize
src/core/controllers/authorize
src/core/application/authorize
src/core/domain/auth
src/core/pipes/auth
```

Do not replace the top-level layers with mixed feature modules such as `src/authorize/ui`, `src/authorize/application`, and `src/authorize/infrastructure` unless a separate architecture decision changes this rule.

This is stricter than pure feature-first organization because Passport has sensitive browser/server and key-custody boundaries. The architecture should make it hard for route handlers, React code, Google Drive adapters, Pubky SDK adapters, WebCrypto code, environment parsing, and domain/application logic to collapse into one feature folder.

## Runtime Boundaries

Passport keeps runtime-specific adapters under `src/infrastructure/browser` and `src/infrastructure/server` instead of promoting browser and server to separate top-level trees.

This is intentional:

- Next.js App Router owns a shared `src/app` tree where route handlers, server components, and client component boundaries coexist.
- React UI is not inherently browser-only under React Server Components.
- `src/core` is intentionally runtime-independent and may be used from either browser-capable or server-capable entry points.
- Only concrete adapters are runtime-pinned, so runtime folders belong inside `src/infrastructure`.

Runtime separation is enforced by module markers and architecture tests, not by folder naming alone:

- Production files in `src/infrastructure/server` must import `server-only`.
- Production files in `src/infrastructure/browser` must import `client-only`.
- Browser infrastructure must not import server infrastructure or server env modules.
- Server infrastructure must not import browser infrastructure or public env modules.
- UI must not import server infrastructure or server env modules.


## Layer responsibilities

### `src/app`

Next.js App Router routes, layouts, pages, and route handlers.

Allowed:

- Route composition.
- Server/client component boundaries.
- Calling controllers.
- Mapping HTTP requests to controllers.
- Exporting metadata and layouts.

Forbidden:

- Business logic.
- Cryptographic policy.
- Direct Google Drive logic.
- Direct Pubky SDK signing logic.
- Large route handlers.

### `src/ui`

React components and feature screens.

Allowed:

- Rendering state.
- User interaction.
- Form state.
- Visual layout.
- Calling controller hooks/view models.

Forbidden:

- Direct Google Drive access.
- Direct Pubky SDK access.
- Direct private key manipulation.
- Business rules that belong in use cases.

### `src/core/domain`

Pure TypeScript domain models and invariants.

Allowed:

- Value objects.
- Domain entities.
- Pure validation helpers.
- Domain errors.
- Capability models.
- Auth request models.
- Passport file models.

Forbidden:

- React.
- Next.js.
- Fetch.
- Google SDK.
- Pubky SDK.
- WebCrypto concrete APIs.
- Browser globals.
- Environment variables.
- Logging implementation.

### `src/core/application`

Use cases.

Allowed:

- Coordinate domain objects and ports.
- Enforce application flow.
- Return application results.
- Handle expected domain/application errors.

Forbidden:

- Concrete infrastructure.
- Fetch.
- Window/localStorage.
- Google SDKs.
- Pubky SDK adapters.
- Next.js route details.

### `src/core/ports`

Interfaces for external dependencies.

Examples:

- `GoogleIdentityPort`
- `ProviderIdTokenVerifier`
- `PassportFileRepository`
- `WrappingKeyPort`
- `PassportCryptoPort`
- `PubkyKeypairPort`
- `PubkyAuthTokenPort`
- `PubkySignupPort`
- `PubkyDiscoveryPort`
- `RelayPort`
- `HomegatePort`
- `IdentitySessionRepository`
- `Clock`
- `Logger`
- `Metrics`

Provider-specific identity and storage seams should stay narrow. Do not collapse browser provider identity, server ID-token verification, encrypted passport storage, and wrapping-secret source into one provider service.

### `src/core/controllers`

Input/output mapping between UI/API and use cases.

Allowed:

- Translate UI events into use-case calls.
- Translate HTTP request data into use-case input.
- Map use-case results to view-ready state.
- Map errors to user-facing states.

Forbidden:

- Pubky signing details.
- Google Drive details.
- Encryption implementation.
- Long orchestration that belongs in use cases.

### `src/core/pipes`

Pure parsing and validation.

Examples:

- Parse `pubkyauth://` URLs.
- Parse capabilities.
- Validate callback URLs.
- Validate relay URLs.
- Parse `passport.json`.
- Validate Google claim shape.

### `src/core/stores`

UI state only.

Allowed:

- Selected identity state.
- Setup progress state.
- Authorization UI state.
- Non-sensitive display/session state.

Forbidden:

- Private key persistence.
- Drive access.
- Pubky SDK calls.
- Crypto operations.

### `src/infrastructure/browser`

Browser-only adapters.

Required:

- Production adapter files must start with `import "client-only"`.

Examples:

- Google Identity Services.
- Google Drive API.
- WebCrypto.
- IndexedDB/session memory.
- Pubky WASM/browser SDK.
- HTTP Relay client.

### `src/infrastructure/server`

Server-only adapters.

Required:

- Production adapter files must start with `import "server-only"`.

Examples:

- Google ID token verifier.
- HKDF/KMS wrapping-key service.
- Rate limiting.
- Homegate server client.
- Structured logger.

### `src/infrastructure/composition`

Dependency wiring.

Examples:

- `clientContainer.ts`
- `serverContainer.ts`

### `src/libs/env`

Typed environment parsing and runtime config exports.

Allowed:

- Public browser config in `src/libs/env/public.ts`.
- Server-only config in `src/libs/env/server.ts`.
- Pure parser helpers that accept env-like input for unit tests.
- URL and required-value validation helpers used only by env parsing.

Required:

- `src/libs/env/server.ts` must start with `import "server-only"`.
- Public env modules may only export `NEXT_PUBLIC_*` values; they may read `NODE_ENV` only to enforce development-localhost URL validation.
- Server env modules may parse server-only secrets and service URLs.
- Keep public and server exports separate. Do not add a mixed `src/libs/env/index.ts` barrel that re-exports server config.

Import boundaries:

- `src/core` must not import `src/libs/env` or read `process.env`.
- `src/libs/env/server.ts` may only be imported by server-only locations such as route handlers, server components, `src/infrastructure/server`, and server composition modules.
- `src/libs/env/server.ts` must not be imported by `src/ui`, `src/infrastructure/browser`, client components, or `src/core`.

## Import boundary rules

Import boundaries are enforced by both lint rules and architecture tests:

- `eslint.config.mjs` blocks direct forbidden imports and runtime globals in `src/core`.
- `test-utils/architecture/core-boundaries.test.ts` scans `src/core` for forbidden alias imports, relative imports into outer layers, and direct runtime references. It also enforces browser/server infrastructure isolation, allowed server env importers, UI server-only restrictions, and runtime marker imports.

The architecture test is the authoritative core boundary gate because `src/core` may use relative imports and ESLint import restrictions do not resolve every relative path escape. ESLint remains a fast direct-import guard. The architecture test is intentionally heuristic: it scans ESM imports and dynamic imports, does not scan `require()`, and its runtime-reference scan strips comments but not string literals. If core grows beyond this heuristic, consider parser-backed enforcement such as `eslint-plugin-boundaries` or `import/no-restricted-paths`.

Required rules:

- Core must not import app.
- Core must not import UI.
- Core must not import infrastructure.
- Domain must not import application.
- Domain must not import controllers.
- Application must depend on ports, not implementations.
- Infrastructure may implement ports.
- Browser infrastructure must not import server infrastructure.
- Server infrastructure must not import browser infrastructure.
- Server env modules must only be imported by server-capable locations.
- Provider folders must not import sibling provider folders. For example, `src/infrastructure/server/providers/google` must not import a future `src/infrastructure/server/providers/apple` folder.
- Feature folders inside a layer may import allowed dependencies for that layer only.
- Matching feature names across layers do not weaken dependency direction.

## Testing rule

Application tests should use fake ports.

They should not hit:

- Google.
- Google Drive.
- Pubky network.
- Homegate.
- HTTP Relay.
- Homeserver.
