import { ConfirmDeletionDialog } from "@/client/ui/shared/confirmDeletionDialog";

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
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  onRetryAuthorization: () => void;
  open: boolean;
  pending: boolean;
}) {
  const errorMessage =
    error === null
      ? null
      : `${
          canRetryAuthorization
            ? "Could not connect to Google. Try again."
            : "Could not remove Google access. Please try again."
        } ${error}`;

  return (
    <ConfirmDeletionDialog
      canConfirm={canConfirm}
      confirmLabel="Confirm deletion"
      error={errorMessage}
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
