# 0001. Instance configuration and feature flags

Status: Proposed
Date: 2026-09-25

## Context

Passport v2 can be self-hosted. Operators need to switch Google recovery off, run invite-only, set a default homeserver, and restrict which homegates users may connect to. Today configuration is a handful of environment variables read in `src/server/environment.ts` and there is no client-visible notion of "what this instance supports".

## Decision

- One zod schema, `InstanceConfig`, in `src/server/environment.ts`, parsed once at server start. Unknown or invalid values fail startup, never fall back silently.
- Variables (all optional unless stated):
  - `PASSPORT_FEATURE_GOOGLE` (`true`/`false`, default `true` when `GOOGLE_CLIENT_ID` is set, otherwise `false`)
  - `PASSPORT_INVITE_ONLY` (`true`/`false`, default `false`)
  - `PASSPORT_DEFAULT_HOMESERVER` (pubky of the homeserver shown as default; empty means none)
  - `PASSPORT_ALLOWED_HOMEGATES` (comma-separated HTTPS origins; empty means only `HOMEGATE_URL`; `*` means any user-entered URL that passes validation)
  - `PASSPORT_ALLOW_CUSTOM_HOMESERVER` (`true`/`false`, default `false`)
  - `PASSPORT_INSTANCE_NAME` (display name shown in the popup header)
- A `PublicInstanceConfig` projection of that schema is server-rendered into the root layout once. Client code reads it through one typed accessor in `src/client/logic/instance/` and never from `process.env`, query parameters, or storage.
- Feature checks in UI are declarative: components receive `config.features.google` and branch; no scattered `if (process.env...)`.
- CSP connect-src is derived from the same config (homeserver origins, allowed homegates), so config and policy cannot drift.

## Boundaries touched

B2, B7 in `docs/security/threat-model.md`.

## Consequences

- Google dependencies remain in the bundle when the flag is off; acceptable for v2, revisit with route-level code splitting later.
- Tests get a `makeInstanceConfig()` helper in `test-utils` to exercise each flag combination.

## Open questions

- Should `PASSPORT_INVITE_ONLY` hide sign-up entirely or show a "request invite" link configurable by the operator?
