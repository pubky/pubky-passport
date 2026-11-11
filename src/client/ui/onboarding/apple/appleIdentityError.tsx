import { useState } from "react";

import type { AppleIdentityViewError } from "@/client/logic/apple-identity/AppleIdentityController";
import { GoogleIdentityErrorDetails as IdentityErrorDetails } from "@/client/ui/googleIdentityErrorDetails";
import { BackButton } from "@/client/ui/shared/backButton";
import { ConfirmDeletionDialog } from "@/client/ui/shared/confirmDeletionDialog";
import { TrashIcon } from "@/client/ui/shared/icons";
import { PassportScreen } from "@/client/ui/shared/passportScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { DisplayHeading, LeadText } from "@/client/ui/shared/primitives/typography";
import { appleIdentityErrorMessage, signedInAppleAccountNotice } from "./appleIdentityErrorMessage";
import { ContinueWithApple } from "./continueWithApple";

type Replacement = { id: string; description: string; error?: string; onConfirm: () => void };

/** A failed Apple setup or restore; "Try again" restarts with Apple's window. */
function AppleIdentityError({
  appleEmail,
  error,
  onBack,
  onReplaceInvalidFile,
  onReplaceUndecryptableFile,
  onTryAgain,
}: {
  appleEmail?: string | undefined;
  error: AppleIdentityViewError;
  onBack: () => void;
  onReplaceInvalidFile: () => void;
  onReplaceUndecryptableFile: () => void;
  onTryAgain: () => void;
}) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const replacement = passportFileReplacement(error.code, {
    onReplaceInvalidFile,
    onReplaceUndecryptableFile,
  });

  return (
    <>
      <PassportScreen className="gap-6">
        <div className="flex flex-col gap-6">
          <DisplayHeading accent="interrupted." aria-label="Setup interrupted.">
            Setup
          </DisplayHeading>
          <LeadText>{appleIdentityErrorMessage(error.code)}</LeadText>
          {appleEmail ? (
            <p className="break-words text-sm font-medium leading-5 text-muted-foreground">
              {signedInAppleAccountNotice(appleEmail)}
            </p>
          ) : null}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-6">
          <IdentityErrorDetails error={error} />
          <div
            aria-label="Error actions"
            className="mt-auto grid w-full grid-cols-1 gap-3"
            role="group"
          >
            <div className="w-full">
              <ContinueWithApple autoFocus onContinue={onTryAgain} />
            </div>
            {replacement ? (
              <Button
                className="w-full"
                onClick={() => setConfirmationOpen(true)}
                size="lg"
                type="button"
                variant="destructive"
              >
                <TrashIcon />
                Delete &amp; create new
              </Button>
            ) : null}
            <BackButton onClick={onBack} />
          </div>
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

/** Only file conditions Passport verified itself offer replacement. */
function passportFileReplacement(
  code: AppleIdentityViewError["code"],
  actions: { onReplaceInvalidFile: () => void; onReplaceUndecryptableFile: () => void },
): Replacement | undefined {
  switch (code) {
    case "invalid_passport_file":
    case "invalid_passport_file_delete_failed":
      return {
        id: "replace-invalid-icloud-file",
        description:
          "Passport will delete the damaged file from iCloud and create a new Pubky identity. This cannot be undone.",
        ...(code === "invalid_passport_file_delete_failed"
          ? { error: "Passport could not delete the damaged identity file. Please try again." }
          : {}),
        onConfirm: actions.onReplaceInvalidFile,
      };
    case "decrypt_failed":
    case "undecryptable_passport_file_delete_failed":
      return {
        id: "replace-undecryptable-icloud-file",
        description:
          "Passport will delete the identity file it cannot decrypt from iCloud and create a new Pubky identity. The Pubky stored in that file will no longer be recoverable with this Apple Account. This cannot be undone.",
        ...(code === "undecryptable_passport_file_delete_failed"
          ? { error: "Passport could not delete the identity file. Please try again." }
          : {}),
        onConfirm: actions.onReplaceUndecryptableFile,
      };
    default:
      return undefined;
  }
}

export { AppleIdentityError };
