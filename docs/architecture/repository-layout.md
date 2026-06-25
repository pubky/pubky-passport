# Repository Layout

## Layout principle

Passport uses a hybrid structure:

```txt
Layer-first for dependency and runtime boundaries.
Feature-namespaced inside layers for ownership and navigation.
```

Do not use top-level feature modules that mix Next.js routes, React UI, application logic, domain rules, and infrastructure adapters. Passport's sensitive browser/server and key-custody boundaries are easier to review and enforce when the top-level layers remain separate.

## Target layout after scaffold

```txt
src/
  app/
    layout.tsx
    globals.css

    authorize/
      page.tsx

    dashboard/
      page.tsx

    settings/
      page.tsx

    api/
      wrapping-key/
        route.ts

      homegate/
        google-invite/
          route.ts

      health/
        route.ts

  core/
    domain/
      auth/
      identity/
      google/
      setup/

    application/
      authorize/
      identity/
      backup/
      homegate/
      setup/

    ports/

    controllers/
      authorize/
      identity/
      settings/

    pipes/
      auth/
      google/
      passport-file/

    stores/

    errors/

  infrastructure/
    browser/
      google/
      crypto/
      storage/
      pubky/
      relay/

    server/
      google/
      secrets/
      homegate/
      rate-limit/

    composition/

  ui/
    components/

    features/
      authorize/
      setup/
      dashboard/
      settings/

  libs/
    env/
      public.ts
      public-parser.ts
      server.ts
      server-parser.ts
      url.ts
    logger/
    security/

test-utils/
  fakes/
  builders/
```

## Feature placement examples

Authorization request parsing and review should be split by layer:

```txt
src/app/authorize/
src/ui/features/authorize/
src/core/controllers/authorize/
src/core/application/authorize/
src/core/domain/auth/
src/core/pipes/auth/
src/infrastructure/browser/relay/
```

Google-backed identity setup and restore should be split by runtime and layer:

```txt
src/ui/features/setup/
src/core/application/setup/
src/core/application/identity/
src/core/domain/identity/
src/core/domain/google/
src/core/ports/
src/infrastructure/browser/google/
src/infrastructure/browser/crypto/
src/infrastructure/browser/storage/
src/infrastructure/browser/pubky/
src/infrastructure/server/google/
src/infrastructure/server/secrets/
```

Homegate invite support should keep server-only network behavior out of core:

```txt
src/app/api/homegate/google-invite/
src/core/application/homegate/
src/core/ports/
src/infrastructure/server/homegate/
src/infrastructure/server/rate-limit/
```

Feature names may differ across layers when the domain concept is broader than a route. For example, the `/authorize` route uses the `auth` domain and pipes because Pubky auth parsing is a protocol concern, not just a page concern.

## Important rule

Do not collapse this into feature folders that mix:

- React UI.
- Next route handlers.
- Google SDK calls.
- Pubky SDK calls.
- Domain logic.
- Crypto details.

Feature folders are acceptable inside a layer, such as `src/ui/features/authorize` or `src/core/application/authorize`.

Application/domain boundaries stay separate.

Matching feature names across layers do not weaken dependency direction. For example, `src/core/application/authorize` may depend on `src/core/domain/auth` and `src/core/ports`, but it must not import `src/ui/features/authorize`, `src/app/authorize`, or `src/infrastructure/browser/relay`.

The most important boundaries are enforced in `eslint.config.mjs` and `test-utils/architecture/core-boundaries.test.ts`; update those checks when adding new protected layers or forbidden dependencies.
