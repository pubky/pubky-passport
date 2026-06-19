# Pubky Passport Mockups Analysis

## Page 3 - Google OAuth Screens

These are Google-owned screens, not Passport UI:

- G1 account chooser.
- G2 Google sign-in confirmation.
- G3 Google Drive/app configuration consent.

Passport initiates these flows but must not recreate Google-owned UI.

## Page 4 - New User Setup

Passport-owned screens:

- G4 setup progress.
- G5 success screen.

Required progress steps:

1. Store encrypted key in Google Drive.
2. Sign up to homeserver.
3. Publish PKDNS records.
4. Activate identity.

Success screen shows:

- Google account.
- Pubky public key.
- Copy action.
- Continue button for the requesting app domain.

## Page 5 - Returning User Authorization

Passport-owned screens:

- A1 authorize sign-in.
- A2 switch identity.

A1 confirms the identity that will be used for the requesting domain. A2 allows choosing another known identity when that behavior is implemented.

## Page 6 - Permissions

Passport-owned screen:

- A3 permissions confirmation.

Must show requested capabilities before signing:

- Path.
- Read permission.
- Write permission.
- Trust warning.

## Page 7 - Regular Passport App

Passport-owned screens:

- Home identity card.
- Identity switcher entry point.
- Settings.
- Detach from Google entry point.
- Manual `pubkyauth://` paste flow.
- Backup/export entry point.

The bootstrap decision is to include entry points in the MVP surface and implement the risky recovery/export details in dedicated, reviewed PRs.
