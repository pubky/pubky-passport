import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";
import { DRIVE_PERMISSION_HINT } from "@/client/ui/googleDrivePermissionPrompt";
import { googleIdentityErrorMessage } from "@/client/ui/googleIdentityErrorMessage";
import { ConfirmDeletionDialog } from "@/client/ui/shared/confirmDeletionDialog";
import { TechnicalDetails } from "@/client/ui/shared/errorScreen";

/** What the person types to acknowledge that this browser will keep the key's only copy. */
const ONLY_COPY_WORD = "ONLY COPY";

/**
 * The last step before Google's window opens: it names the account to choose there, so a person
 * with several Google accounts picks the one holding this backup. Without a checked recovery file
 * the word to type is the acknowledgement that this browser will keep the key's only copy, so the
 * Drive backup is never deleted on a plain "detach".
 */
function ConfirmGoogleDetachment({
  canConfirm,
  canRetryAuthorization,
  email,
  error,
  onCancel,
  onConfirm,
  onRetryAuthorization,
  onlyCopy,
  open,
  pending,
}: {
  canConfirm: boolean;
  canRetryAuthorization: boolean;
  /** The Google account attached to this pubky. */
  email: string;
  error: GoogleIdentityViewError | null;
  onCancel: () => void;
  onConfirm: () => void;
  onRetryAuthorization: () => void;
  /** No recovery file of this key was checked, so detaching leaves its only copy in this browser. */
  onlyCopy: boolean;
  open: boolean;
  pending: boolean;
}) {
  const googleWindow = `Google’s window will open: sign in as ${email}. ${DRIVE_PERMISSION_HINT} Passport needs both to delete the encrypted backup and its copy in your “Pubky Passport” folder. You stay signed in on this device.`;
  return (
    <ConfirmDeletionDialog
      canConfirm={canConfirm}
      confirmLabel="Confirm detachment"
      confirmationWord={onlyCopy ? ONLY_COPY_WORD : "DETACH"}
      description={
        onlyCopy ? (
          <>
            <strong className="mb-2 block font-semibold text-foreground">
              No backup of this key has been verified, so this browser will keep the only copy of
              your key. If its data is cleared, this pubky is gone unless it is in Pubky Ring.
            </strong>{" "}
            {googleWindow}
          </>
        ) : (
          googleWindow
        )
      }
      error={
        error === null
          ? undefined
          : googleIdentityErrorMessage(error, { operation: "detach", email })
      }
      errorDetails={
        error === null ? undefined : (
          <TechnicalDetails code={error.code} detail={error.detailCode} />
        )
      }
      id="detach-google"
      onCancel={onCancel}
      onConfirm={onConfirm}
      open={open}
      pending={pending}
      pendingLabel="Detaching…"
      retryAction={
        canRetryAuthorization ? { label: "Try again", onClick: onRetryAuthorization } : undefined
      }
      title="Detach from Google?"
    />
  );
}

export { ConfirmGoogleDetachment, ONLY_COPY_WORD };
