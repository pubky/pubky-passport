# Testing

Tests live beside the production code they exercise. A test should have one clear
owner: a public function, class, component, route, or root configuration file.

## Principles

- Assert public results and user-visible behavior, not folder structure, import
  direction, implementation details, or complete CSS class lists.
- Keep validation matrices with the parser or validator that owns them. Higher
  layers need one representative success or failure only when their wiring can fail
  independently.
- Cover meaningful boundaries: empty and malformed input, exact limits and limit
  plus one, provider failures, cleanup, retries, and secret handling.
- Add a shared helper only when several suites need the same fake or assertion. Keep
  scenario setup in the suite that owns it.
- Treat coverage as a map of untested code, not proof that behavior is correct.
  CI enforces one coarse aggregate minimum to catch major regressions without
  rewarding filler tests.

## Layout

| Location | Purpose |
| --- | --- |
| `src/**/*.test.ts(x)` | Unit, adapter, controller, and component behavior |
| `next.config.test.ts` | Root Next.js security configuration |
| `e2e/*.spec.ts` | Browser routing, headers, callbacks, and secret-leak checks |
| `test-utils/` | Small helpers shared by multiple colocated suites |
| `*.staging.test.ts` | Opt-in checks against live Pubky services |

Architecture and naming conventions are reviewed in code review. ESLint and Next's
runtime markers provide cheap build-time checks for the few browser/server import
restrictions that need automation.

## Commands

```bash
pnpm test             # watch mode
pnpm test:run         # Vitest once
pnpm test:coverage    # Vitest with source coverage
pnpm test:e2e         # production build plus Playwright
pnpm check            # lint, types, coverage, and production build
pnpm check:critical   # audit, check, and Playwright
```

The staging Pubky smoke test is intentionally separate because it consumes provider
quota and creates a new identity:

```bash
PUBKY_STAGING_HOMEGATE_URL=https://staging-homegate.example/ \
PUBKY_STAGING_GOOGLE_ID_TOKEN=<fresh-id-token> \
pnpm test:staging:pubky
```

`PUBKY_STAGING_RELAY_URL` can select a relay; otherwise the SDK default is used.
Playwright traces may contain request data, so browser tests must use synthetic
credentials and authorization requests only.

`pnpm test:coverage` prints a summary and writes per-file details to
`coverage/index.html`.
