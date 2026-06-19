# ADR-0005: Clean architecture boundaries

Status: Accepted

## Decision

Use this dependency flow:

```txt
Next.js app routes / UI
  -> controllers
    -> application use cases
      -> domain models + ports
        -> infrastructure adapters
```

## Hard rules

- Domain/application code must not import Next.js.
- Domain/application code must not import React.
- Domain/application code must not import Google SDKs.
- Domain/application code must not import concrete Pubky SDK adapters.
- Browser crypto, Google Drive, Relay, and Pubky SDK live behind ports.
- Next.js route handlers stay thin.
- Import-boundary linting enforces this.

## Outcome

Use this boundary model for the scaffold and enforce it with `eslint.config.mjs` import restrictions.
