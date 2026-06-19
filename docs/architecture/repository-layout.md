# Repository Layout

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
    logger/
    security/

test-utils/
  fakes/
  builders/
```

## Important rule

Do not collapse this into feature folders that mix:

- React UI.
- Next route handlers.
- Google SDK calls.
- Pubky SDK calls.
- Domain logic.
- Crypto details.

Feature folders are acceptable inside UI.

Application/domain boundaries stay separate.
