# Pubky Passport Mockups Analysis

This document captures implementation-relevant findings from the interactive mockup export. It is intentionally constrained to the first MVP described in `docs/product/passport-mvp-brief.md` and `docs/product/feature-context.md`.

The mockups include flows beyond the MVP, especially self-managed key onboarding and recovery phrase screens. Those are documented here only to avoid accidental implementation in the first milestone.

## Screen Inventory

### Core App

#### Home, Google-Linked

Purpose:

- Primary Passport landing page after successful Google-backed identity setup or restore.
- Shows identity status.
- Provides entry points to manual authorization, backup, and settings.

MVP status: must implement.

#### Home, Self-Managed

Purpose:

- Landing page variant for a self-managed identity.

MVP status: out of scope.

Do not implement self-managed primary onboarding for the first MVP.

#### Settings

Purpose:

- Regular settings surface.
- Provides a Detach from Google entry point.

MVP status: implement as a small surface with scoped entries only.

### Manual Authorization

#### Manual Authorize

Purpose:

- Allows a user to paste a `pubkyauth://` deep link.
- Continues into authorization request validation and capability review.

MVP status: must implement.

Security rule:

- Never redisplay or persist the full pasted authorization URL after parsing.

### Authorization Flow

The mockups imply this sequence:

1. Manual paste or `/authorize?d=<encoded-pubkyauth-url>` entry.
2. Request validation.
3. Permissions or capability review.
4. Explicit approval.
5. Signing and relay handoff.
6. Success callback redirect.

MVP status: must implement, with signing blocked until explicit confirmation.

### Google Login Flow

Visible screens:

- G1: choose Google account.
- G2: signing back in loading state.
- G3: Google consent and scopes.
- G4: setting up account progress state.
- G5: success, identity ready.

MVP status: must implement equivalent Passport-owned states. Google-owned account and consent screens are initiated by Passport but not recreated as Passport UI.

### Detach Flow

Visible sequence:

- D1: understand the risk.
- D2: choose backup.
- D2a: recovery phrase backup.
- Final destructive delete or detach confirmation.

MVP status: Detach from Google is an entry point. Full detach custody behavior and recovery phrase backup are deferred unless explicitly scoped in a follow-up issue.

### Self-Managed Onboarding

Visible but out of MVP:

- Overview.
- Restore from file.
- Restore from phrase.
- CAPTCHA.
- Phone verification.
- OTP.

MVP status: out of scope.

## User Flows

### First-Time Google User Onboarding

Visible or implied flow:

1. User starts from `/authorize` or the regular Passport surface.
2. User signs in with Google.
3. User grants required Google consent.
4. Passport shows account setup progress.
5. Passport creates the Pubky identity if no encrypted Drive identity exists.
6. Passport stores encrypted key material in Google Drive `appDataFolder/passport.json`.
7. Passport retrieves a Homegate invite with a valid Google ID token.
8. Passport signs up to the homeserver.
9. Passport publishes required discovery, PKDNS, or PKARR records according to verified SDK behavior.
10. Passport shows identity ready.
11. If this started from authorization, Passport shows capability review.
12. User approves.
13. Passport signs the AuthToken, posts it to relay, and redirects to the success callback.

Implementation note:

- Steps 6 through 9 are product requirements but are not fully detailed in the mockup UI. Treat progress labels as UX, not proof of concrete API behavior.

### Returning Google User Restore

Visible or implied flow:

1. User signs in with Google.
2. Browser reads encrypted `passport.json` from Google Drive `appDataFolder`.
3. Browser requests the wrapping secret from the Passport server after Google ID-token verification.
4. Browser decrypts key material in memory only.
5. Passport restores the Pubky identity.
6. Passport shows identity confirmation or proceeds to capability review.

Security rule:

- The Passport server must never receive the Google Drive access token, encrypted Drive file, decrypted Pubky key material, or browser-local key material.

### Capability Review

Visible or implied flow:

1. Show the requesting application or safe requesting domain.
2. Show requested capabilities.
3. Warn when requested scope is broad.
4. Keep approval disabled or unavailable until the request is validated and review UI is loaded.
5. User approves or cancels.
6. Approval starts signing and relay handoff.
7. Cancel redirects through the validated cancel callback when available.

Security rule:

- Never show the full callback URL, full authorization URL, request secret, or relay payload.

### Success

Authorization success flow:

1. AuthToken signing completes.
2. Relay upload completes.
3. Passport redirects to the validated success callback.

Regular app success state:

- Home shows a ready identity state.

### Cancel

Expected flow:

1. User cancels before signing.
2. Passport redirects to the validated cancel callback when provided.
3. If no safe callback is available, Passport shows a safe local cancellation state.

### Error

Needed states:

- Invalid authorization request.
- Google login failure.
- Google consent denied.
- Google session expired.
- Drive restore failure.
- Identity creation failure.
- Homeserver signup failure.
- Discovery publication failure.
- Signing failure.
- Relay handoff failure.
- Unsafe or invalid callback.

Most error states are implied rather than explicitly shown in the mockups.

### Dashboard Usage

Expected regular Passport usage:

1. User opens Passport.
2. Home shows identity status.
3. User can choose manual authorize, backup entry point, or settings.
4. Manual authorize accepts a pasted `pubkyauth://` link and continues to validation and capability review.

### Backup Entry

Mockup status:

- Visible from Home.

MVP status:

- Implement as an entry point only unless a follow-up issue scopes backup/export behavior.

Do not implement recovery phrase or self-managed restore as part of the first MVP.

### Detach From Google Entry

Mockup status:

- Visible from Settings.
- Includes warning and backup-related steps.

MVP status:

- Implement a Detach from Google entry point and warning surface.
- Defer actual custody transition, key export, rotation, or recovery phrase behavior unless explicitly scoped.

## UI Requirements

### Home

Purpose:

- Identity dashboard and main Passport surface.

Primary CTA:

- Authorize.

Secondary CTAs:

- Backup.
- Settings.

Required state:

- Google sign-in display state.
- Pubky identity ready or not ready state.
- Public identity information if available.

Loading behavior:

- Show identity loading or restore progress when needed.

Error behavior:

- Show a safe, non-sensitive identity load failure.

Visual hierarchy:

- Identity status first.
- Primary authorization action second.
- Secondary account-management actions after that.

### Manual Authorize

Purpose:

- Accept a pasted Pubky auth request.

Primary CTA:

- Continue.

Secondary CTA:

- Cancel or back.

Validation:

- Require a valid `pubkyauth://` request.
- Reject malformed links before capability review.
- Do not continue if required fields are missing or invalid.

Security behavior:

- Do not redisplay the full pasted URL after parsing.
- Do not persist the raw input.

### Google Sign-In And Consent States

Purpose:

- Start Google authentication and Drive consent flows.

Primary CTA:

- Continue with Google.

Loading behavior:

- Signing in.
- Restoring session.
- Waiting for consent.

Error behavior:

- Account rejected.
- Consent denied.
- Network failure.
- Session expired.

Implementation note:

- Passport should not recreate Google-owned account picker or consent screens.

### Setup Progress

Purpose:

- Communicate that identity setup or restore is in progress.

Suggested progress labels:

- Signing in.
- Restoring identity.
- Creating identity.
- Configuring homeserver.
- Publishing discovery.
- Ready.

Copy guidance:

- Avoid exposing sensitive or overly technical details.
- Keep progress labels stable even if internal SDK calls are refactored.

### Capability Review

Purpose:

- Let the user review what the requesting app can access before signing.

Primary CTA:

- Approve.

Secondary CTA:

- Cancel.

Required state:

- Safe requesting app display name or domain.
- Capability list.
- Validation status for relay and callbacks.

Loading behavior:

- Signing pending after approval.
- Relay handoff pending after signing.

Error behavior:

- Signing failure.
- Relay failure.
- Invalid request.
- Unsafe callback.

Visual hierarchy:

- Requesting app identity.
- Capabilities.
- Scope warning when relevant.
- Approval and cancel actions.

### Settings

Purpose:

- Identity management surface.

Visible MVP actions:

- Detach from Google entry point.

Implementation note:

- Keep settings thin until additional settings are explicitly scoped.

### Detach From Google

Purpose:

- Introduce a destructive or custody-changing account action.

Primary CTA:

- Continue to detach warning or setup.

Final CTA:

- Detach, only when actual implementation is scoped.

Secondary CTA:

- Cancel.

Required copy:

- Explain that detaching from Google affects account recovery and key custody.

MVP behavior:

- Entry point and warning only unless backend and custody behavior are explicitly implemented.

## Component Breakdown

Recommended practical components:

- App shell.
- Mobile header.
- Identity status card.
- Public identity summary.
- Google sign-in panel.
- Setup progress card.
- Capability review card.
- Capability row.
- Warning banner.
- Error panel.
- Success panel.
- Manual authorization form.
- URL validation message.
- Settings list.
- Settings row.
- Destructive confirmation panel.
- Loading overlay.
- Inline spinner.
- Footer action bar.

Do not over-abstract these components before repeated use is clear.

## Data And State Needed

Safe UI state only.

Identity state:

- Signed-in state.
- Google display name if shown.
- Google avatar if shown.
- Pubky public key.
- Display handle if available.
- Identity ready, creating, restoring, or failed state.

Authorization state:

- Parsed request validity.
- Safe requesting app name.
- Safe requesting domain.
- Capability list.
- Callback validation status.
- Relay validation status.
- Authorization pending, approved, cancelled, or failed state.

Google state:

- Signed in.
- Consent granted.
- Session expired or unavailable.

Provisioning state:

- Identity exists.
- Restoring identity.
- Creating identity.
- Homeserver ready.
- Discovery published.

General UI state:

- Current screen.
- Loading state.
- Safe error message.
- Success state.

Never store in UI state:

- Google access tokens.
- Google ID tokens.
- Google Drive tokens.
- Pubky private key material.
- Wrapping or encryption secrets.
- Pubky auth request secrets.
- Full callback URLs.
- Full authorization URLs.

## Security And Privacy Notes

### Manual Auth

Never redisplay the pasted authorization URL after parsing.

Safe alternatives:

- Requesting app name.
- Requesting domain.
- Capability summary.

### Callback URLs

Never render full callback URLs with query parameters.

Safe alternatives:

- `example.com`.
- `example.com (verified)`.

### Relay

Never expose relay payloads or encrypted token handoff details in the UI.

### Google

Never display tokens or raw Google `sub`.

Use Google display profile data only where appropriate.

### Identity

Safe to show:

- Public key.
- Display handle.

Never expose:

- Private key material.
- Exported raw key material.
- Browser-local decrypted key material.

## MVP Fit Check

### Must Implement

- Google login entry and Passport-owned loading/error states.
- Google-backed identity restore or create flow.
- Home identity status.
- Settings surface.
- Manual authorize.
- `/authorize?d=<encoded-pubkyauth-url>` support.
- Authorization request validation.
- Capability review.
- Setup or restore loading state.
- Authorization success state and callback redirect.
- Authorization cancel handling.
- Authorization error handling.
- Backup entry point.
- Detach from Google entry point.

### Visible Entry Point Only

- Backup/export.
- Detach from Google, unless actual custody behavior is explicitly scoped.
- Settings items beyond the minimum MVP surface.

### Defer

- Recovery phrase UX.
- Restore from file.
- Restore from phrase.
- Multi-identity management.
- Full self-managed onboarding.
- Actual backup/export implementation.
- Actual detach custody transition or key rotation.

### Out Of Scope

- QR login.
- Phone verification.
- CAPTCHA.
- OTP.
- Self-managed primary onboarding.
- Non-Google providers.
- Native mobile app flows.

## Gaps And Questions

1. No explicit invalid deep-link screen is shown.
2. Relay failure UI is not shown.
3. Callback failure UI is not shown.
4. Google session expiration behavior is unclear.
5. Returning-user restore progress is not clearly differentiated from first-time setup.
6. Capability review layout details are only implied.
7. Offline behavior is not shown.
8. Identity publication retry behavior is unspecified.
9. Detach completion behavior is beyond MVP scope and needs a follow-up issue.
10. Backup UX is represented visually but should remain an entry point for MVP.

## Suggested Implementation Slices

### Slice 1: App Surface

- App shell.
- Routing.
- Home.
- Settings.
- Backup and Detach entry points as non-destructive placeholders.

### Slice 2: Authorization Parser And Manual Entry

- Manual authorize page.
- `/authorize?d=<encoded-pubkyauth-url>` entry handling.
- Deep-link parsing and validation.
- Safe invalid request errors.

### Slice 3: Static Capability Review UI

- Requesting app display.
- Capability list.
- Broad-scope warnings.
- Approve and cancel interaction states without signing integration.

### Slice 4: Google-Owned Flow Integration Surfaces

- Google sign-in trigger UI.
- Passport-owned loading states.
- Passport-owned error states.

### Slice 5: Identity Setup And Restore Progress

- Setup progress UI.
- Returning-user restore progress UI.
- Ready and failure states.

### Slice 6: Signing, Relay, And Callback Surfaces

- Signing pending state.
- Relay pending state.
- Success, cancel, and error callback handling UI.

### Slice 7: Settings Refinement

- Backup entry point copy.
- Detach warning copy.
- Follow-up issue links or placeholder states if used by the project workflow.
