# Pubky Passport MVP Brief

## Goal

Pubky Passport is a standalone web app at `https://passport.pubky.app` that reduces Pubky onboarding friction by supporting Login with Google for the first MVP.

Passport lets a user create or restore a Pubky identity using Google login and Google Drive-backed encrypted key storage, then authorize a third-party app through Pubky Auth.

## Decided MVP Scope

Included:

- Standalone Passport web app.
- `/authorize` flow accepting an encoded `pubkyauth://` deep link.
- Google login as the only identity provider.
- Google Drive `appDataFolder/passport.json` encrypted key storage.
- First-time Pubky identity creation.
- Returning-user Pubky identity restoration.
- Homegate invite retrieval using a valid Google ID token.
- Homeserver signup.
- Required Pubky discovery, PKDNS, or PKARR publication steps in the concrete SDK flow.
- Capability review before signing.
- Pubky AuthToken signing with the restored or newly created Pubky key.
- HTTP Relay handoff.
- Success, cancel, and error callback handling.
- Basic regular Passport app surface for identity status, manual auth paste, backup entry point, and Detach from Google entry point.

Excluded from the first MVP:

- QR-code login.
- Full Pubky Ring replacement.
- Login with own key as the primary onboarding path.
- Non-Google identity providers.
- Native mobile app.
- Advanced multi-identity management.
- Passphrase import as the main flow.
- Unscoped web signer behavior.

## Main Authorization Flow

1. Third-party app creates a Pubky auth request.
2. User lands on `/authorize` with an encoded `pubkyauth://` deep link.
3. Passport parses and validates relay, secret, capabilities, and callbacks.
4. Passport ensures the Google user has a Pubky identity by restoring from encrypted Drive storage or creating a new key.
5. User reviews target app/domain and requested capabilities.
6. User authorizes.
7. Passport signs a Pubky AuthToken.
8. Passport posts the encrypted token to HTTP Relay.
9. Passport redirects to the success/cancel/error callback.
10. Third-party app completes its session flow.

## Security Model Summary

The browser is the only place where both required key-recovery pieces meet:

- The encrypted Drive file.
- The Passport-server-derived encryption/wrapping secret.

The Passport server must never receive the Google Drive access token, decrypted Pubky key material, browser-local decrypted key material, or encrypted Drive file contents. Google must never receive the Passport-server-derived secret.

## Implementation Discipline

Build one thin vertical slice at a time. The next implementation PR after bootstrap is the Pubky auth request parser only.

Feature-specific implementation context lives in `docs/product/feature-context.md`.

## UI Reference

See:

- `docs/product/source/pubky-passport-prd.pdf`
- `docs/product/mockups-analysis.md`
- `docs/product/mockups/`
