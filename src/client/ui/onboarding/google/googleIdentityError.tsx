import { useState } from "react";

import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";
import {
  GoogleDrivePermissionPrompt,
  GooglePermissionGuide,
} from "@/client/ui/googleDrivePermissionPrompt";
import { GoogleIdentityErrorDetails } from "@/client/ui/googleIdentityErrorDetails";
import { googleIdentityErrorMessage } from "@/client/ui/googleIdentityErrorMessage";
import { RotateCcwIcon, TrashIcon } from "@/client/ui/shared/icons";
import { BackButton } from "@/client/ui/shared/backButton";
import { ConfirmDeletionDialog } from "@/client/ui/shared/confirmDeletionDialog";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

/** A confirmed deletion of the Drive identity file followed by creation of a new identity. */
type PassportFileReplacement = {
  id: string;
  description: string;
  error: string | undefined;
  onConfirm: () => void;
};

function GoogleIdentityError({
  error,
  onBack,
  onReplaceInvalidFile,
  onReplaceUndecryptableFile,
  onTryAgain,
  onContinueWithoutVisibleBackup,
}: {
  error: GoogleIdentityViewError;
  onBack: () => void;
  onReplaceInvalidFile?: (() => void) | undefined;
  onReplaceUndecryptableFile?: (() => void) | undefined;
  onTryAgain: () => void;
  onContinueWithoutVisibleBackup?: (() => void) | undefined;
}) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const replacement = passportFileReplacement(error.code, {
    onReplaceInvalidFile,
    onReplaceUndecryptableFile,
  });

  if (error.code === "google_authorization_denied") {
    return <GoogleAccessDenied onBack={onBack} onTryAgain={onTryAgain} />;
  }

  if (
    error.code === "google_drive_access_required" ||
    error.code === "visible_backup_permission_missing"
  ) {
    return (
      <GoogleDrivePermissionPrompt
        mode={error.code === "google_drive_access_required" ? "required" : "optional"}
        onBack={onBack}
        onContinue={onContinueWithoutVisibleBackup}
        onTryAgain={onTryAgain}
      />
    );
  }

  return (
    <>
      <PassportScreen className="gap-6 md:max-w-[558px] md:gap-8">
        <div className="flex flex-col gap-6 md:gap-3">
          <DisplayHeading accent="interrupted." aria-label="Setup interrupted.">
            Setup
          </DisplayHeading>
          <LeadText>{googleIdentityErrorMessage(error.code)}</LeadText>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-6">
          <GoogleIdentityErrorDetails error={error} />
          {replacement ? (
            <>
              <div
                aria-label="Mobile error actions"
                className="mt-auto grid w-full grid-cols-1 gap-3 md:hidden"
                role="group"
              >
                <Button className="w-full" onClick={onTryAgain} size="lg" type="button">
                  <RotateCcwIcon />
                  Try again
                </Button>
                <Button
                  className="w-full"
                  onClick={() => setConfirmationOpen(true)}
                  size="lg"
                  type="button"
                  variant="destructive"
                >
                  <TrashIcon />
                  Delete backup &amp; create new pubky
                </Button>
                <BackButton onClick={onBack} />
              </div>
              <div
                aria-label="Desktop error actions"
                className="hidden w-full grid-cols-(--passport-error-actions-columns) gap-3 md:grid md:gap-x-6"
                role="group"
              >
                <BackButton className="md:col-start-1 md:row-start-1" onClick={onBack} />
                <Button
                  className="w-full md:col-start-2 md:row-start-1"
                  onClick={() => setConfirmationOpen(true)}
                  size="lg"
                  type="button"
                  variant="destructive"
                >
                  <TrashIcon />
                  Delete &amp; create new
                </Button>
                <Button
                  className="w-full md:col-start-3 md:row-start-1"
                  onClick={onTryAgain}
                  size="lg"
                  type="button"
                >
                  <RotateCcwIcon />
                  Try again
                </Button>
              </div>
            </>
          ) : (
            <>
              <div
                aria-label="Mobile error actions"
                className="mt-auto grid w-full grid-cols-1 gap-3 md:hidden"
                role="group"
              >
                <Button className="w-full" onClick={onTryAgain} size="lg" type="button">
                  <RotateCcwIcon />
                  Try again
                </Button>
                <BackButton onClick={onBack} />
              </div>
              <div
                aria-label="Desktop error actions"
                className="hidden w-full grid-cols-(--passport-error-actions-columns) gap-3 md:grid md:gap-x-0"
                role="group"
              >
                <BackButton className="md:col-start-1 md:row-start-1" onClick={onBack} />
                <Button
                  className="w-full md:col-start-3 md:row-start-1"
                  onClick={onTryAgain}
                  size="lg"
                  type="button"
                >
                  <RotateCcwIcon />
                  Try again
                </Button>
              </div>
            </>
          )}
        </div>
      </PassportScreen>

      {replacement ? (
        <ConfirmDeletionDialog
          confirmLabel="Delete and create new identity"
          description={replacement.description}
          error={replacement.error}
          id={replacement.id}
          onCancel={() => setConfirmationOpen(false)}
          onConfirm={replacement.onConfirm}
          open={confirmationOpen}
          title="Permanently replace identity?"
        />
      ) : null}
    </>
  );
}

/**
 * Only file conditions Passport has verified itself offer replacement: a file that does not
 * parse, or one that parses but cannot be decrypted for the signed-in Google account.
 */
function passportFileReplacement(
  code: GoogleIdentityViewError["code"],
  actions: {
    onReplaceInvalidFile: (() => void) | undefined;
    onReplaceUndecryptableFile: (() => void) | undefined;
  },
): PassportFileReplacement | undefined {
  switch (code) {
    case "invalid_passport_file":
    case "invalid_passport_file_delete_failed":
      if (!actions.onReplaceInvalidFile) return undefined;
      return {
        id: "replace-invalid-passport-file",
        description:
          "Passport will delete the invalid file from Google Drive and automatically create a new Pubky identity. This cannot be undone.",
        error:
          code === "invalid_passport_file_delete_failed"
            ? "Passport could not delete the invalid identity file. Please try again."
            : undefined,
        onConfirm: actions.onReplaceInvalidFile,
      };
    case "decrypt_failed":
    case "undecryptable_passport_file_delete_failed":
      if (!actions.onReplaceUndecryptableFile) return undefined;
      return {
        id: "replace-undecryptable-passport-file",
        description:
          "Passport will delete the identity file it cannot decrypt from Google Drive and automatically create a new Pubky identity. The Pubky stored in that file will no longer be recoverable from this Google account. This cannot be undone.",
        error:
          code === "undecryptable_passport_file_delete_failed"
            ? "Passport could not delete the identity file. Please try again."
            : undefined,
        onConfirm: actions.onReplaceUndecryptableFile,
      };
    default:
      return undefined;
  }
}

function GoogleAccessDenied({
  onBack,
  onTryAgain,
}: {
  onBack: () => void;
  onTryAgain: () => void;
}) {
  return (
    <PassportScreen className="gap-6 md:gap-8">
      <div className="flex flex-col gap-6 md:gap-3">
        <DisplayHeading accent="denied." desktopAccentOnNewLine>
          Google <span className="hidden md:inline">Drive</span> access
        </DisplayHeading>
        <LeadText className="md:hidden">
          Passport needs Google Drive access to create or restore your Pubky.
        </LeadText>
        <LeadText className="hidden md:block">
          Passport needs access to your Google Drive to create or restore your Pubky.
        </LeadText>
      </div>
      <GooglePermissionGuide />
      <div
        aria-label="Mobile error actions"
        className="mt-auto grid w-full grid-cols-1 gap-3 md:hidden"
        role="group"
      >
        <Button className="w-full" onClick={onTryAgain} size="lg" type="button">
          <RotateCcwIcon />
          Try again
        </Button>
        <BackButton onClick={onBack} />
      </div>
      <div
        aria-label="Desktop error actions"
        className="hidden w-full grid-cols-(--passport-error-actions-columns) items-center gap-0 md:grid"
        role="group"
      >
        <BackButton className="md:col-start-1 md:row-start-1" onClick={onBack} />
        <Button
          className="w-full md:col-start-3 md:row-start-1"
          onClick={onTryAgain}
          size="lg"
          type="button"
        >
          <RotateCcwIcon />
          Try again
        </Button>
      </div>
    </PassportScreen>
  );
}

export { GoogleIdentityError };
