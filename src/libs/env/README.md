# Environment Configuration

Environment parsing is split by runtime. `public.ts` exposes only validated
`NEXT_PUBLIC_*` values suitable for browser bundles. `server.ts` starts with
`import "server-only"` and exposes secrets and server-only endpoints.

Do not add a shared environment barrel. Browser-capable modules must never import
`server.ts`, and feature code must receive configuration as an input rather than read
environment variables.
