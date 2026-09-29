import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";
import { DRIVE_PERMISSION_HINT } from "@/client/ui/googleDrivePermissionPrompt";
import { googleIdentityErrorMessage } from "@/client/ui/googleIdentityErrorMessage";
import { ConfirmDeletionDialog } from "@/client/ui/shared/confirmDeletionDialog";
import { TechnicalDetails } from "@/client/ui/shared/errorScreen";

/**
 * The last step before Google's window opens: it names the account to choose there, so a person
 * with several Google accounts picks the one holding this backup.
 */
function ConfirmGoogleDetachment({
  canConfirm,
  canRetryAuthorization,
  email,
  error,
  onCancel,
  onConfirm,
  onRetryAuthorization,
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
  open: boolean;
  pending: boolean;
}) {
  return (
    <ConfirmDeletionDialog
      canConfirm={canConfirm}
      confirmLabel="Confirm detachment"
      confirmationWord="DETACH"
      description={`Google’s window will open: sign in as ${email}. ${DRIVE_PERMISSION_HINT} Passport needs both to delete the encrypted backup and its copy in your “Pubky Passport” folder. You stay signed in on this device.`}
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

export { ConfirmGoogleDetachment };
