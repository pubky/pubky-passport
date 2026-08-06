# UI Architecture

The UI follows screaming architecture: capability names dominate the tree, while
framework-level building blocks stay in `shared`.

```txt
ui/
  identity/
    identityFlow.tsx        Routes signed-out, onboarding, active, and management states
    onboarding/             Google sign-in, identity restore/create, and setup completion
    management/             Active identity, switching, backup, and local account controls
  authorization/            Permission review and application authorization
  application-shell/        UI shared by every application state, such as the header
  shared/
    primitives/             Figma-verified, business-agnostic controls
    brand/                  Passport and provider brand marks
    navigation/             Application-wide navigation controls
    mergeClassNames.ts      Tailwind class composition helper
```

## Ownership rules

- A component used by one capability stays with that capability.
- Promote a component to `shared` only when unrelated capabilities reuse it.
- TypeScript implementation and test filenames use `camelCase`.
- Files name the behavior they implement: `identityFlow`, `signInPage`, and
  `activeIdentityHome` instead of generic names such as `app` or `page`.
- Tests remain beside the behavior they verify.
- Shared primitives contain no identity, authorization, storage, or network logic.
- Avoid barrel exports so dependencies remain visible at each import site.

## Visual sources

- Figma file `01ZvjSPZnKTNmaEWz0yJsq` is the visual source of truth.
- `pubky/pubky-app` commit `2bfe3f5c379a10f75c9811db9d7e47f7bb56f508`
  supplies the compatible SHADCN/Tailwind implementation pattern.

Copy only the variants required by Passport. Do not copy application state, routes,
or feature hierarchies from Pubky App.

UI state may contain public identities, safe hosts, capabilities, progress, and typed
safe errors. It must never contain tokens, secret key material, wrapping keys,
ciphertext, raw authorization URLs, request secrets, or full callback URLs.
