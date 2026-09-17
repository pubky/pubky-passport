import { useState } from "react";

import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";
import { GoogleIdentityErrorDetails } from "@/client/ui/googleIdentityErrorDetails";
import { googleIdentityErrorMessage } from "@/client/ui/googleIdentityErrorMessage";
import { RotateCcwIcon, TrashIcon } from "@/client/ui/shared/icons";
import { BackButton } from "@/client/ui/shared/backButton";
import { ConfirmDeletionDialog } from "@/client/ui/shared/confirmDeletionDialog";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";

function GoogleIdentityError({
  error,
  onBack,
  onReplaceInvalidFile,
  onTryAgain,
}: {
  error: GoogleIdentityViewError;
  onBack: () => void;
  onReplaceInvalidFile?: (() => void) | undefined;
  onTryAgain: () => void;
}) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const replaceInvalidFile =
    error.code === "invalid_passport_file" || error.code === "invalid_passport_file_delete_failed"
      ? onReplaceInvalidFile
      : undefined;

  if (error.code === "google_authorization_denied") {
    return <GoogleAccessDenied onBack={onBack} onTryAgain={onTryAgain} />;
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
          {replaceInvalidFile ? (
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
                className="hidden w-full grid-cols-[1fr_148px] gap-3 md:grid md:gap-x-6"
                role="group"
              >
                <Button
                  className="w-full md:col-start-1 md:row-start-1"
                  onClick={() => setConfirmationOpen(true)}
                  size="lg"
                  type="button"
                  variant="destructive"
                >
                  <TrashIcon />
                  Delete file and create new identity
                </Button>
                <Button
                  className="w-full md:col-start-2 md:row-start-1"
                  onClick={onTryAgain}
                  size="lg"
                  type="button"
                >
                  <RotateCcwIcon />
                  Try again
                </Button>
                <BackButton className="md:col-start-1 md:row-start-2" onClick={onBack} />
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
                className="hidden w-full grid-cols-[120px_1fr_148px] gap-3 md:grid md:gap-x-0"
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

      {replaceInvalidFile ? (
        <ConfirmDeletionDialog
          confirmLabel="Delete and create new identity"
          description="Passport will delete the invalid file from Google Drive and automatically create a new Pubky identity. This cannot be undone."
          error={
            error.code === "invalid_passport_file_delete_failed"
              ? "Passport could not delete the invalid identity file. Please try again."
              : undefined
          }
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
        className="hidden w-full grid-cols-[120px_1fr_148px] items-center gap-0 md:grid"
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
