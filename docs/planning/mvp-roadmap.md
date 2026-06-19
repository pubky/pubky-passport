# Pubky Passport MVP Roadmap

## PR 1 - Repository Bootstrap

- Next.js scaffold.
- Clean architecture folders.
- Agent instructions.
- Product docs.
- Security docs.
- CI.
- Test tooling.

## PR 2 - Pubky Auth Request Parser

- Parse encoded `pubkyauth://` deep link.
- Validate relay, secret, caps, callbacks.
- Derive display domain.
- Unit tests.

## PR 3 - Static Authorization UI

- A1 authorize sign-in.
- A2 switch identity placeholder.
- A3 permissions screen.
- Fake identity.
- Component tests.

## PR 4 - Wrapping-Key API

- `/api/wrapping-key`.
- Google ID token verifier port.
- HKDF-backed or KMS-backed wrapping key service.
- Redacted logs.
- Route tests.

## PR 5 - Pubky SDK Key Material Spike

- Confirm keypair generation.
- Confirm serialization/restoration.
- Confirm AuthToken signing.
- Confirm homeserver signup and PKDNS/PKARR publication calls.
- Update ADR-0001.

## PR 6 - Google Drive Encrypted Passport Storage

- Browser Google login adapter.
- Drive appDataFolder repository.
- `passport.json` read/write.
- Browser crypto adapter.

## PR 7 - First-Time Setup Flow

- Create keypair.
- Store encrypted key.
- Get Homegate invite.
- Sign up to homeserver.
- Publish records.
- Setup progress screen.

## PR 8 - Returning User Restore Flow

- Restore from Drive.
- Decrypt in browser.
- Show identity confirmation.
- Authorize.

## PR 9 - End-To-End Authorization

- Sign AuthToken.
- Post encrypted token to relay.
- Redirect success/cancel/error.
- Fake third-party app E2E test.

## PR 10 - Regular Passport App Surface

- Home screen.
- Manual auth paste.
- Backup/export entry point.
- Detach from Google entry point.
