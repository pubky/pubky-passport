# UI Architecture

The UI follows screaming architecture: capability names dominate the tree, while
framework-level building blocks stay in `shared`.

```txt
ui/
  identity-dashboard/         Root identity navigation and signed-in experience
    overview/                 Active identity home
    management/               Operations on an existing identity
      encrypted-backup/       Password-encrypted local recovery export
      detach-from-google/     Backup gate and Google detachment flow
      migrate-to-pubky-ring/  Export of the active identity to Pubky Ring
  identity-catalog/           Live local identities shared by page flows
    selection/                Existing identity selection plus Add identity flow
  onboarding/                 Provider-neutral create-or-restore flow
    google/                   Google authorization and identity establishment
  authorization/              Permission review and application authorization
    review/                   Requesting app, capabilities, and selected identity
    manual-entry/             Paste and QR authorization entry
  shared/
    primitives/               Figma-verified, business-agnostic controls
    brand/                    Passport and provider brand marks
    navigation/               Application-wide navigation controls
    layout/                   Repeated Passport screen geometry
    mergeClassNames.ts        Tailwind class composition helper
```

## Ownership rules

- `src/app/layout.tsx` owns the global Passport header and other route-wide chrome.
- A component used by one capability stays with that capability.
- Promote a component to `shared` only when unrelated capabilities reuse it.
- Provider-neutral onboarding composes provider features; provider features never import their parent flow.
- TypeScript implementation and test filenames use `camelCase`.
- Files name the behavior they implement: `identityDashboard`, `signInPage`, and
  `identityOverview` instead of generic names such as `app` or `page`.
- Tests remain beside the behavior they verify.
- Shared primitives contain no identity, authorization, storage, or network logic.
- Avoid barrel exports so dependencies remain visible at each import site.

## State ownership

- Browser repositories and controllers own persisted identities and external operations.
- `identity-catalog` owns controller construction, catalog subscription, and disposal.
- `identity-dashboard` owns root identity navigation and keeps onboarding mounted until the user
  leaves its completion screen.
- Multi-screen features use a local reducer with discriminated view states and semantic events.
- Reducers are pure: event handlers perform controller calls and dispatch their safe outcomes.
- Components use `useState` only for local form and widget details.
- Refs may guard an async operation or reference DOM nodes; refs never decide which page is visible.
- Store identity IDs in navigation state. A destructive operation may capture its safe public target
  summary when that target must remain stable after local removal.
- Do not add a global UI store while page-local feature flows remain the only consumers.

## Visual sources

- Figma file `01ZvjSPZnKTNmaEWz0yJsq` is the visual source of truth.
- `pubky/pubky-app` commit `2bfe3f5c379a10f75c9811db9d7e47f7bb56f508`
  supplies the compatible SHADCN/Tailwind implementation pattern.

Copy only the variants required by Passport. Do not copy application state, routes,
or feature hierarchies from Pubky App.

UI state may contain public identities, safe hosts, capabilities, progress, and typed
safe errors. It must never contain tokens, wrapping keys, ciphertext, raw authorization
requests, request secrets, or full callback URLs. The Pubky Ring migration feature is
the sole exception for secret-bearing UI data: its one-shot migration URL exists only
in that mounted feature, is never persisted or logged, and is discarded on navigation.
