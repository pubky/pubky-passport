import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";
import { DRIVE_PERMISSION_HINT } from "@/client/ui/googleDrivePermissionPrompt";
import { googleIdentityErrorMessage } from "@/client/ui/googleIdentityErrorMessage";
import { ConfirmDeletionDialog } from "@/client/ui/shared/confirmDeletionDialog";
import { TechnicalDetails } from "@/client/ui/shared/errorScreen";

function ConfirmGoogleDetachment({
  canConfirm,
  canRetryAuthorization,
  error,
  onCancel,
  onConfirm,
  onRetryAuthorization,
  open,
  pending,
}: {
  canConfirm: boolean;
  canRetryAuthorization: boolean;
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
      description={`${DRIVE_PERMISSION_HINT} Passport needs both to delete your backup and its visible copies.`}
      error={error === null ? undefined : googleIdentityErrorMessage(error.code)}
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
      pendingLabel="Removing…"
      retryAction={
        canRetryAuthorization ? { label: "Try again", onClick: onRetryAuthorization } : undefined
      }
      title="Remove Google Access"
    />
  );
}

export { ConfirmGoogleDetachment };
