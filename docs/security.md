# Security

- Authorization secrets stay in the URL fragment, are captured before hydration,
  and are removed from browser history.
- Private keys and OAuth tokens stay outside React state and logs.
- Recovery envelopes use authenticated encryption and origin-bound wrapping keys.
- Imported and exported secret keys are verified against their recorded public key.
- Temporary key buffers are cleared after use.
- Browser, server, and shared import boundaries are enforced by ESLint.

Recovery passwords require at least 12 characters. The Pubky SDK recovery format
uses Argon2id, but password strength still depends on length and unpredictability.

Report vulnerabilities privately to the project maintainers. Do not include live
credentials, authorization URLs, private keys, or recovery files in reports.
