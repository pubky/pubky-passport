# Core Layer Rules

`src/core` contains framework-independent business logic.

Core uses feature-namespaced folders inside architectural layers, for example:

- `src/core/controllers/authorize`
- `src/core/application/authorize`
- `src/core/domain/auth`
- `src/core/pipes/auth`

These matching feature names are for ownership and navigation only. They do not allow core code to import UI, app routes, infrastructure adapters, environment modules, React, or Next.js.

Forbidden imports from `src/core`:

- `next`
- `next/*`
- `react`
- `react/*`
- `@/app/*`
- `@/ui/*`
- `@/infrastructure/*`
- `@/libs/env/*`
- Google SDKs
- Pubky SDK concrete adapters
- Browser globals such as `window`, `document`, `localStorage`
- Environment reads such as `process.env`

Use ports from `src/core/ports` for all external dependencies.
