# ADR-0004: Homegate Google invite flow

Status: Accepted for MVP baseline, pending Homegate API contract details

## Context

Users need a Homegate invite code to sign up to the homeserver.

The PRD says Homegate can hand out an invite code for a valid Google ID token.

## Decision

Passport must retrieve a Homegate invite using a valid Google ID token. The server-side path must verify Google token signature, issuer, audience, expiration, and subject before any invite issuance or rate-limit accounting.

Implementation should represent Homegate behind a `HomegatePort` and Google verification behind a server-side adapter so application logic remains framework- and network-independent.

## Questions

- Does Homegate already support Google ID-token invite issuance?
- Does Passport browser call Homegate directly?
- Does Passport server proxy to Homegate?
- Which Google OAuth client ID/audience is accepted?
- What rate limits apply?
- What error states are returned?
- Are invite codes one-time use?

## Rate-limit identity

Use:

```txt
HMAC-SHA256(secret_pepper, iss || "\n" || sub)
```

Do not use email.

## Outcome

Proceed with the port boundary and server-side token-verification requirement. Confirm the exact Homegate endpoint shape in the implementation PR before coding the concrete adapter.
