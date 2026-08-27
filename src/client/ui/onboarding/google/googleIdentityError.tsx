import { useState } from "react";

import type { GoogleIdentityViewError } from "../../../logic/google-identity/GoogleIdentityController";
import { RotateCcwIcon, TrashIcon } from "../../shared/actionIcons";
import { BackButton } from "../../shared/backButton";
import { ConfirmDeletionDialog } from "../../shared/confirmDeletionDialog";
import { cn } from "../../shared/mergeClassNames";
import { PassportScreen } from "../../shared/passportScreen";
import { Button } from "../../shared/primitives/button";
import { Label } from "../../shared/primitives/label";
import { DisplayHeading, LeadText } from "../../shared/primitives/typography";
import { SignInContext } from "../../shared/signInContext";

function GoogleIdentityError({ error, onBack, onReplaceInvalidFile, onTryAgain, signInTo }: {
  error: GoogleIdentityViewError;
  onBack: () => void;
  onReplaceInvalidFile?: () => void;
  onTryAgain: () => void;
  signInTo?: string;
}) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const replaceInvalidFile = error.code === "invalid_passport_file"
    || error.code === "invalid_passport_file_delete_failed"
    ? onReplaceInvalidFile
    : undefined;

  return (
    <>
      <PassportScreen className="gap-6 md:max-w-[680px]">
        <div className="flex flex-col gap-6 md:gap-3">
          <DisplayHeading accent="interrupted." aria-label="Setup interrupted.">Setup </DisplayHeading>
          {signInTo ? <SignInContext requester={signInTo} /> : null}
          <LeadText>{errorMessage(error.code)}</LeadText>
          <div className="flex flex-col gap-2 md:mt-5">
            <Label id="google-identity-error-label">Error</Label>
            <div
              aria-labelledby="google-identity-error-label"
              className="flex min-h-[60px] flex-col justify-center gap-1 rounded-lg border border-dashed border-input bg-black/10 py-4 pl-6 pr-5 shadow-xs"
              role="group"
            >
              <p className="break-all text-base font-medium leading-6 text-foreground">{error.code}</p>
              {error.detailCode !== undefined
                ? <p className="break-all text-base font-medium leading-6 text-foreground">{error.detailCode}</p>
                : null}
            </div>
          </div>
        </div>

        <div className="grid w-full grid-cols-1 gap-3 md:mt-5 md:grid-cols-[120px_1fr_300px]">
          {replaceInvalidFile ? (
            <Button className="w-full md:col-start-3 md:row-start-1" onClick={() => setConfirmationOpen(true)} size="lg" type="button" variant="destructive">
              <TrashIcon />Delete file and create new identity
            </Button>
          ) : null}
          <Button className={cn("w-full md:col-start-3", replaceInvalidFile ? "md:row-start-2" : "md:row-start-1")} onClick={onTryAgain} size="lg" type="button">
            <RotateCcwIcon />Try again
          </Button>
          <BackButton className={cn("md:col-start-1", replaceInvalidFile ? "md:row-start-2" : "md:row-start-1")} onClick={onBack} />
        </div>
      </PassportScreen>

      {replaceInvalidFile ? (
        <ConfirmDeletionDialog
          confirmLabel="Delete and create new identity"
          description="Passport will delete the invalid file from Google Drive and automatically create a new Pubky identity. This cannot be undone."
          error={error.code === "invalid_passport_file_delete_failed"
            ? "Passport could not delete the invalid identity file. Please try again."
            : undefined}
          id="replace-invalid-passport-file"
          onCancel={() => setConfirmationOpen(false)}
          onConfirm={replaceInvalidFile}
          open={confirmationOpen}
          title="Permanently replace identity?"
        />
      ) : null}
    </>
  );
}

function errorMessage(code: GoogleIdentityViewError["code"]): string {
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
    case "publication_failed": return "Passport could not publish your identity's PKDNS records.";
    case "local_save_failed": return "Your identity was activated, but could not be saved in this browser.";
    case "wrapping_key_failed": return "Passport could not unlock your encrypted identity with this Google account.";
    case "homeserver_signup_invitation_failed": return "Passport could not obtain a homeserver signup invitation.";
    case "invalid_passport_file": return "Passport found your encrypted identity file in Google Drive, but it is damaged and cannot be restored.";
    case "invalid_passport_file_delete_failed": return "Passport could not delete the invalid identity file from Google Drive. You can try deleting it again.";
    case "google_authorization_denied": return "Google access was denied. Passport needs Google Drive access to create or restore your Pubky.";
    case "google_authorization_popup_closed": return "The Google authorization window was closed before access was granted.";
    case "google_authorization_popup_failed_to_open": return "Passport could not open the Google authorization window. Check your popup settings and try again.";
    case "google_authorization_failed": return "Google authorization did not complete successfully.";
    default: return "Passport could not finish creating or restoring your Pubky.";
  }
}

export { GoogleIdentityError };
