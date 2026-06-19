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
- `GoogleDriveKeyRepository`
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

Examples:

- Google Identity Services.
- Google Drive API.
- WebCrypto.
- IndexedDB/session memory.
- Pubky WASM/browser SDK.
- HTTP Relay client.

### `src/infrastructure/server`

Server-only adapters.

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

## Import boundary rules

When scaffold exists, enforce with lint rules:

- Core must not import app.
- Core must not import UI.
- Core must not import infrastructure.
- Domain must not import application.
- Domain must not import controllers.
- Application must depend on ports, not implementations.
- Infrastructure may implement ports.

## Testing rule

Application tests should use fake ports.

They should not hit:

- Google.
- Google Drive.
- Pubky network.
- Homegate.
- HTTP Relay.
- Homeserver.
