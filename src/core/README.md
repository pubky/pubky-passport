# Core Layer Rules

`src/core` contains framework-independent business logic.

Forbidden imports from `src/core`:

- `next`
- `next/*`
- `react`
- `react/*`
- `@/app/*`
- `@/ui/*`
- `@/infrastructure/*`
- Google SDKs
- Pubky SDK concrete adapters
- Browser globals such as `window`, `document`, `localStorage`

Use ports from `src/core/ports` for all external dependencies.
