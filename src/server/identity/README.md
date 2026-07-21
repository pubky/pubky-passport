# Server Identity

This folder contains server-owned identity operations: provider token verification,
wrapping-key derivation, rate limiting, and the wrapping-key route flow. It may
import pure provider identity models from `src/features`, but never imports
`src/browser`.

The server derives wrapping material only from a verified canonical issuer and
subject plus its own secret. It must never receive Drive access tokens, encrypted
Drive files, decrypted Pubky key material, or browser-local wrapping material.

Provider-specific server integration belongs in a nested provider folder such as
`google/`, `apple/`, or `proton/` when its verification contract is confirmed.

The MVP limiter is process-local and keys its short-lived counters with an HMAC of
the verified issuer and subject. Production multi-instance deployments must replace
it with a shared implementation before relying on its quota across instances.
