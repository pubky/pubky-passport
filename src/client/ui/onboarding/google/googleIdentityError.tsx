import { type ReactNode, useState } from "react";

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
import { DetailField } from "@/client/ui/shared/detailField";
import { ErrorScreen } from "@/client/ui/shared/errorScreen";
import { Button } from "@/client/ui/shared/primitives/button";

/** A confirmed deletion of the Drive identity file followed by creation of a new identity. */
type PassportFileReplacement = {
  id: string;
  description: string;
  /** An earlier deletion failed: deleting again is the way on, not signing in again. */
  retry: boolean;
  onConfirm: () => void;
};

/** What deleting a backup costs, said before the person opens the confirmation. */
const REPLACEMENT_LOSS =
  "Deleting this backup means the pubky in it can no longer be restored with this Google account. If you have that pubky in Pubky Ring or a recovery file, go back and add it from there instead.";

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

  if (error.code === "google_authorization_popup_closed") {
    return <GoogleSignInCancelled onBack={onBack} onTryAgain={onTryAgain} />;
  }

  const recovery = googleIdentityErrorRecovery(error, {
    canReplaceFile: replacement !== undefined,
  });
  const openConfirmation = () => setConfirmationOpen(true);
  let action: ReactNode = null;
  if (replacement?.retry) {
    action = (
      <Button className="w-full" onClick={openConfirmation} size="lg" type="button">
        <RotateCcwIcon />
        Try deleting again
      </Button>
    );
  } else if (recovery.retryHelps) {
    // Where the same step would fail again, Try again is not offered as the way out.
    action = (
      <Button className="w-full" onClick={onTryAgain} size="lg" type="button">
        <RotateCcwIcon />
        Try again
      </Button>
    );
  }
  return (
    <>
      <ErrorScreen
        accent="interrupted."
        action={action}
        back={<BackButton onClick={onBack} />}
        cause={googleIdentityErrorMessage(error)}
        details={{ code: error.code, detail: error.detailCode }}
        nextStep={recovery.nextStep}
        secondaryAction={
          // Deleting abandons the pubky in the file, so it stays a quiet text action.
          replacement && !replacement.retry ? (
            <Button onClick={openConfirmation} type="button" variant="linkDestructive">
              <TrashIcon />
              Delete backup and start over…
            </Button>
          ) : null
        }
        title="Setup"
      >
        {replacement ? (
          <p className="text-sm leading-5 text-muted-foreground">{REPLACEMENT_LOSS}</p>
        ) : null}
      </ErrorScreen>

      {replacement ? (
        <ConfirmDeletionDialog
          confirmLabel="Delete and start over"
          description={replacement.description}
          id={replacement.id}
          onCancel={() => setConfirmationOpen(false)}
          onConfirm={replacement.onConfirm}
          open={confirmationOpen}
          title="Delete this backup and start over?"
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
          "Passport will delete the damaged backup from Google Drive and create a new pubky right away. This can’t be undone.",
        retry: code === "invalid_passport_file_delete_failed",
        onConfirm: actions.onReplaceInvalidFile,
      };
    case "passport_file_undecryptable":
    case "undecryptable_passport_file_delete_failed":
      if (!actions.onReplaceUndecryptableFile) return undefined;
      return {
        id: "replace-undecryptable-passport-file",
        description:
          "Passport will delete the backup it can no longer unlock from Google Drive and create a new pubky right away. The pubky in that backup can then no longer be restored with this Google account. This can’t be undone.",
        retry: code === "undecryptable_passport_file_delete_failed",
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
  return (
    <ErrorScreen
      accent="elsewhere."
      back={<BackButton onClick={onBack} />}
      cause={googleIdentityErrorMessage({ code: "foreign_passport_file" })}
      nextStep="Passport cannot confirm which site created this file. Only use your identity on a Passport site you already trust. To create a new identity here, go back and choose a different Google account."
      title="Identity found"
    >
      <DetailField label="Site named in the file (unverified)" value={passportFileOrigin} />
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
      nextStep="Try again and allow Passport’s Google Drive access in Google’s window. The second permission also puts a copy of your backup in a “Pubky Passport” folder you can see."
      title={
        <>
          Google <span className="hidden md:inline">Drive</span> access
        </>
      }
    />
  );
}

/**
 * Google's window closed before it answered. The person usually closed it on purpose, so this is
 * not reported as a failure with a code: nothing was created or changed.
 */
function GoogleSignInCancelled({
  onBack,
  onTryAgain,
}: {
  onBack: () => void;
  onTryAgain: () => void;
}) {
  return (
    <ErrorScreen
      accent="cancelled."
      action={
        <Button className="w-full" onClick={onTryAgain} size="lg" type="button">
          <RotateCcwIcon />
          Try again
        </Button>
      }
      back={<BackButton onClick={onBack} />}
      cause={googleIdentityErrorMessage({ code: "google_authorization_popup_closed" })}
      title="Google sign-in"
    />
  );
}

export { GoogleIdentityError };
