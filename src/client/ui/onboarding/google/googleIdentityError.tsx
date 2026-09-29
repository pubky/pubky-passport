import { useId, useState } from "react";

import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";
import {
  GoogleDrivePermissionPrompt,
  GooglePermissionGuide,
} from "@/client/ui/googleDrivePermissionPrompt";
import {
  googleIdentityErrorMessage,
  googleIdentityErrorRecovery,
} from "@/client/ui/googleIdentityErrorMessage";
import { googlePermissionPromptMode } from "@/client/ui/googlePermissionPromptMode";
import { RotateCcwIcon, TrashIcon } from "@/client/ui/shared/icons";
import { BackButton } from "@/client/ui/shared/backButton";
import { ConfirmDeletionDialog } from "@/client/ui/shared/confirmDeletionDialog";
import { ErrorScreen } from "@/client/ui/shared/errorScreen";
import { Button } from "@/client/ui/shared/primitives/button";
import { Label } from "@/client/ui/shared/primitives/label";

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

  if (error.code === "foreign_passport_file" && error.passportFileOrigin !== undefined) {
    return <ForeignPassportFile onBack={onBack} passportFileOrigin={error.passportFileOrigin} />;
  }

  if (error.code === "google_authorization_denied") {
    return <GoogleAccessDenied onBack={onBack} onTryAgain={onTryAgain} />;
  }

  const permissionMode = googlePermissionPromptMode(error.code, "establish");
  if (permissionMode !== undefined) {
    return (
      <GoogleDrivePermissionPrompt
        mode={permissionMode}
        onBack={onBack}
        onContinue={onContinueWithoutVisibleBackup}
        onTryAgain={onTryAgain}
      />
    );
  }

  const recovery = googleIdentityErrorRecovery(error, {
    canReplaceFile: replacement !== undefined,
  });
  return (
    <>
      <ErrorScreen
        accent="interrupted."
        action={
          // Where the same step would fail again, Try again is not offered as the way out.
          recovery.retryHelps ? (
            <Button className="w-full" onClick={onTryAgain} size="lg" type="button">
              <RotateCcwIcon />
              Try again
            </Button>
          ) : null
        }
        back={<BackButton onClick={onBack} />}
        cause={googleIdentityErrorMessage(error.code)}
        details={{ code: error.code, detail: error.detailCode }}
        nextStep={recovery.nextStep}
        secondaryAction={
          replacement ? (
            <Button
              className="text-destructive-text"
              onClick={() => setConfirmationOpen(true)}
              type="button"
              variant="ghost"
            >
              <TrashIcon />
              Delete backup &amp; create new pubky
            </Button>
          ) : null
        }
        title="Setup"
      />

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
 * parse, or one this origin wrote that its key no longer decrypts. A file from another Passport
 * origin is never offered for deletion.
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
    case "passport_file_undecryptable":
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

/**
 * A Drive file that names another Passport origin and that this origin could not unlock. The
 * origin is unauthenticated: it comes from a file that failed validation or decryption, or whose
 * key ID this server does not know. It is therefore shown only as unverified text, never as a
 * link or a place to sign in. Nothing is offered for deletion: the file may be the only copy of
 * an identity another site still opens.
 */
function ForeignPassportFile({
  onBack,
  passportFileOrigin,
}: {
  onBack: () => void;
  passportFileOrigin: string;
}) {
  const originLabelId = useId();

  return (
    <ErrorScreen
      accent="elsewhere."
      back={<BackButton onClick={onBack} />}
      cause={googleIdentityErrorMessage("foreign_passport_file")}
      nextStep="Passport cannot confirm which site created this file. Only use your identity on a Passport site you already trust. To create a new identity here, go back and choose a different Google account."
      title="Identity found"
    >
      <div className="flex flex-col gap-2">
        <Label className="leading-5" id={originLabelId}>
          Site named in the file (unverified)
        </Label>
        <div
          aria-labelledby={originLabelId}
          className="flex min-h-14 flex-col justify-center rounded-lg border border-border bg-black/10 py-4 pl-6 pr-5"
          role="group"
        >
          <p className="break-all text-base font-medium leading-6 text-foreground">
            {passportFileOrigin}
          </p>
        </div>
      </div>
    </ErrorScreen>
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
    <ErrorScreen
      accent="denied."
      action={
        <Button className="w-full" onClick={onTryAgain} size="lg" type="button">
          <RotateCcwIcon />
          Try again
        </Button>
      }
      back={<BackButton onClick={onBack} />}
      cause={
        <>
          <span className="md:hidden">
            Passport needs Google Drive access to create or restore your Pubky.
          </span>
          <span className="hidden md:inline">
            Passport needs access to your Google Drive to create or restore your Pubky.
          </span>
        </>
      }
      help={<GooglePermissionGuide />}
      label="Google Drive access denied."
      nextStep="Try again and allow Passport’s Google Drive access in Google’s window. The second permission also adds a visible recovery copy."
      title={
        <>
          Google <span className="hidden md:inline">Drive</span> access
        </>
      }
    />
  );
}

export { GoogleIdentityError };
