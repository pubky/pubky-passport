# Homegate Server Flow

Owns Homegate invitation types and provider integrations. `google/invite.ts` forwards
a Google ID token to Homegate, which verifies it and enforces invite quotas; Passport
maps the result to safe typed outcomes and never logs the token or raw response.

Future providers use the same layout, for example `apple/invite.ts`, and return the
neutral `HomeserverSignupInvitation` from `types.ts` while owning their endpoint,
credential payload, and upstream error mapping.
