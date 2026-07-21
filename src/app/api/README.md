# API Routes

API routes are Passport's server transport entry points. They validate HTTP request
shape and size, apply response headers, invoke a server-composed flow, and map only
safe typed results to JSON.

Keep provider credentials and sensitive values local to the request. Route code may
pass a Google ID token to the specific server flow that needs it, but it must never
log it, return it, or accept Drive tokens, encrypted Passport files, or Pubky key
material.

Use `src/server` to invoke the server-owned flow. Do not call browser code from an
API route.
