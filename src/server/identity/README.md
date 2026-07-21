# Server Identity

Verifies Google ID tokens, derives wrapping material from the canonical issuer and
subject, and rate-limits requests before returning a key to the browser.

`google` performs verification; `secrets` owns HKDF and server-secret decoding. The
MVP limiter is process-local and stores HMACed identities only; multi-instance
deployments need a shared limiter. This code never receives Drive data or Pubky keys.
