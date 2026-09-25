# 0004. Profile management (pubky-app-specs `profile.json`)

Status: Proposed
Date: 2026-09-25

## Context

Passport should let a user view and edit their `pubky-app-specs` profile (name, bio, image, links, status) so identity is complete at sign-up without a separate social app. The schema is owned by the `pubky-app-specs` crate and exposed to JavaScript through its WASM build.

## Decision

- Validation and serialisation use the `pubky-app-specs` WASM package, never a hand-written TypeScript copy of the schema. The dependency is confined to `src/client/logic/profile/ProfileSpecsAdapter.ts`, mirroring how the Pubky SDK is confined to `PubkySdkAdapter.ts`, and the eslint restricted-import rule is extended accordingly.
- Reads and writes go through the existing SDK adapter with a capability limited to `/pub/pubky.app/profile.json:rw`. Passport never requests broader write access for profile editing.
- Image upload reuses the SDK's blob path; Passport does not proxy images through its server.
- The dashboard gets a `profile` section under `src/client/ui/identity-dashboard/` with its own controller in `src/client/logic/profile/`.

## Boundaries touched

B10.

## Consequences

- First feature suitable for the second-vendor implementer: low security surface, clear spec, good test coverage target.
- Requires the WASM package version pinned in `package.json` and documented in the README.

## Open questions

- Which profile fields are in scope for v2: all of `PubkyAppUser`, or name, bio, image only?
