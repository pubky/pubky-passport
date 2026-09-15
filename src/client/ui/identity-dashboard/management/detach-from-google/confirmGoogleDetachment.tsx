import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";
import { GoogleIdentityErrorDetails } from "@/client/ui/googleIdentityErrorDetails";
import { googleIdentityErrorMessage } from "@/client/ui/googleIdentityErrorMessage";
import { ConfirmDeletionDialog } from "@/client/ui/shared/confirmDeletionDialog";
import { FieldMessage } from "@/client/ui/shared/primitives/fieldMessage";

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
      confirmLabel="Confirm deletion"
      error={
        error === null ? undefined : (
          <>
            <FieldMessage error>{googleIdentityErrorMessage(error.code)}</FieldMessage>
            <GoogleIdentityErrorDetails error={error} />
          </>
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
