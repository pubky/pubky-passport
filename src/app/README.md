# Next.js App

This folder is Passport's Next.js transport boundary. Pages choose the initial
screen and route handlers translate HTTP requests into framework-neutral feature or
composed server-flow calls.

Keep files here thin:

- Parse request shape, set HTTP headers, and create Next.js responses here.
- Put user-facing rendering in `src/ui`.
- Put product rules and typed results in `src/features`.
- Import `src/server` only from server-capable route code.

Client modules must not import `src/server` or server environment configuration.
Route handlers must not receive Drive tokens, encrypted
Passport files, or Pubky key material.
