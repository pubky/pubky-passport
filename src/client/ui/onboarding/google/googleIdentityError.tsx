"use client";

import type { GoogleIdentityFlowError } from "../../../logic/identity/passportIdentityController";
import { RotateCcwIcon } from "../../shared/icons/actionIcons";
import { PassportScreen } from "../../shared/layout/passportScreen";
import { BackButton } from "../../shared/navigation/backButton";
import { Button } from "../../shared/primitives/button";
import { DisplayHeading, LeadText } from "../../shared/primitives/typography";

function GoogleIdentityError({ error, onBack, onTryAgain }: {
  error: GoogleIdentityFlowError;
  onBack: () => void;
  onTryAgain: () => void;
}) {
  return (
    <PassportScreen className="gap-6">
      <div className="flex flex-col gap-6">
        <DisplayHeading accent="interrupted." aria-label="Setup interrupted.">Setup</DisplayHeading>
        <LeadText>{errorMessage(error.code)}</LeadText>
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">Error</p>
          <p className="mt-2 break-all font-medium text-secondary-foreground">{error.code}</p>
          {"cause" in error
            ? <p className="mt-1 break-all text-sm text-muted-foreground">{error.cause}</p>
            : null}
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-3">
        <Button className="w-full" onClick={onTryAgain} size="lg" type="button">
          <RotateCcwIcon />Try again
        </Button>
        <BackButton onClick={onBack} />
      </div>
    </PassportScreen>
  );
}

function errorMessage(code: GoogleIdentityFlowError["code"]): string {
  switch (code) {
    case "create_failed": return "Passport could not create a new Pubky identity.";
    case "decrypt_failed": return "Passport found your encrypted identity, but could not decrypt it.";
    case "drive_create_conflict": return "Another Passport identity file was created at the same time. Check the Google account and try again.";
    case "drive_read_failed": return "Passport could not read your encrypted identity from Google Drive.";
    case "drive_write_failed": return "Passport could not save your encrypted identity to Google Drive.";
    case "encrypt_failed": return "Passport created an identity, but could not encrypt it for Google Drive.";
    case "identity_mismatch": return "The restored Pubky identity did not match the activated homeserver identity.";
    case "restore_failed": return "Passport could not restore the Pubky identity from the encrypted file.";
    case "signin_failed": return "Passport found your encrypted identity, but could not sign in to its homeserver.";
    case "signup_failed": return "Passport found your encrypted identity, but could not finish homeserver setup.";
    case "discovery_failed": return "Passport could not resolve or publish the identity's PKDNS record.";
    case "local_save_failed": return "Your identity was activated, but could not be saved in this browser.";
    case "wrapping_key_failed": return "Passport could not unlock your encrypted identity with this Google account.";
    case "homeserver_signup_invitation_failed": return "Passport could not obtain a homeserver signup invitation.";
    case "google_authorization_popup_closed": return "The Google authorization window was closed before access was granted.";
    case "google_authorization_popup_failed_to_open": return "Passport could not open the Google authorization window. Check your popup settings and try again.";
    case "google_authorization_failed": return "Google authorization did not complete successfully.";
    default: return "Passport could not finish creating or restoring your Pubky.";
  }
}

export { GoogleIdentityError };
