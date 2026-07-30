# Testing Strategy

Tests mirror production ownership. A suite should normally exercise one production
class, pure public function, or adapter operation. Split a suite when it exercises
multiple production use cases, setup branches by unrelated behavior, or a failure
requires tracing through a shared orchestration fixture to find its owner. Do not
split solely because a file crosses an arbitrary line count.

## Test Layers

| Invariant | Primary layer |
| --- | --- |
| Parsing, limits, and strict schemas | Pure unit tests |
| Use-case ordering, typed failures, and cleanup | Application tests with narrow fakes |
| Provider request shape and error mapping | Adapter contract tests |
| Safe view state and explicit approval gating | Controller and component tests |
| Runtime, SDK, UI-entry, and persistence confinement | ESLint plus architecture graph tests |
| Query scrubbing, response headers, CSP, and browser secrecy | Playwright |
| Real signup, discovery, signin, and approval | Staging integration validation |

Duplicate an assertion across layers only when the second layer catches a different
failure mode. Parser tests own callback validation, while Playwright owns confirmation
that application UI, subsequent requests, console output, history, and browser
persistence do not expose synthetic secret canaries.

## Test Infrastructure

- Shared fakes record safe metadata only and implement narrow application ports.
- Prefer small SUT-specific setup functions over universal scenario builders.
- UI tests use controller fakes rather than reproducing persistence schemas.
- Passing Vitest tests suppress application logs; failed tests retain them.
- Coverage is diagnostic and does not replace explicit security invariants.

## Architecture Boundaries

`architecture/architecture-boundaries.test.ts` enforces targeted runtime and
security boundaries through the TypeScript-resolved graph in
`architecture/moduleGraph.ts`. It does not enforce generic application, adapter, or
composition layers.

`architecture/moduleGraph.test.ts` independently verifies aliases, re-exports,
dynamic imports, CommonJS imports, supported extensions, runtime marker placement,
and adversarial persistence access. Change boundary checks only for intentional,
reviewed architecture changes.

## Validation Commands

```bash
pnpm check
```

For authorization, identity custody, runtime-boundary, or other critical changes:

```bash
pnpm exec playwright install chromium
pnpm check:critical
```

`pnpm test:e2e` builds before running Playwright for local convenience.
`pnpm test:e2e:run` expects an existing production build and is used by CI so build
and browser-test failures remain separate.

Playwright traces can contain request URLs and payloads. Browser tests must use only
synthetic credentials and authorization requests. Next.js currently serializes the
original authorization URL into its initial Flight bootstrap before client-side query
scrubbing; removing that framework-level exposure requires a separate ingress or
transport decision.
