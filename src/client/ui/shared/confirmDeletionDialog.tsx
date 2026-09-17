import { type ReactNode, type SubmitEvent, useEffect, useRef, useState } from "react";

import { XIcon } from "./icons";
import { Button } from "./primitives/button";
import { Dialog } from "./primitives/dialog";
import { FieldMessage } from "./primitives/fieldMessage";
import { IconButton } from "./primitives/iconButton";
import { Input } from "./primitives/input";
import { Label } from "./primitives/label";

const CONFIRMATION = "DELETE";

type ConfirmDeletionDialogProps = {
  canConfirm?: boolean;
  confirmLabel: string;
  description?: ReactNode;
  error?: string | undefined;
  /** Rendered under the error message, e.g. a technical-details disclosure. */
  errorDetails?: ReactNode | undefined;
  id: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  pending?: boolean;
  pendingLabel?: string;
  retryAction?: { label: string; onClick: () => void } | undefined;
  title: string;
};

function ConfirmDeletionDialog({
  canConfirm = true,
  confirmLabel,
  description,
  error,
  errorDetails,
  id,
  onCancel,
  onConfirm,
  open,
  pending = false,
  pendingLabel = confirmLabel,
  retryAction,
  title,
}: ConfirmDeletionDialogProps) {
  const [confirmation, setConfirmation] = useState("");
  const confirmationInput = useRef<HTMLInputElement>(null);
  const confirmed = confirmation === CONFIRMATION;

  useEffect(() => {
    if (open) confirmationInput.current?.focus();
  }, [open]);

  function cancel() {
    if (pending) return;
    setConfirmation("");
    onCancel();
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || !canConfirm || pending) return;
    onConfirm();
  }

  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const confirmationId = `${id}-confirmation`;

  return (
    <Dialog
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      className="mb-0 mt-auto w-full max-w-none rounded-t-xl border bg-popover p-6 text-foreground shadow-[0_50px_100px_rgba(5,5,10,0.75)] backdrop:bg-black/75 sm:m-auto sm:max-w-[375px] sm:rounded-xl"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) cancel();
      }}
      open={open}
    >
      <form className="flex flex-col gap-6" onSubmit={submit}>
        <div className="flex flex-col gap-2 pr-10">
          <h2 className="text-xl font-bold leading-7" id={titleId}>
            {title}
          </h2>
          {description ? (
            <p className="text-sm leading-5 text-muted-foreground" id={descriptionId}>
              {description}
            </p>
          ) : null}
        </div>
        <IconButton
          aria-label="Close"
          className="absolute right-[15px] top-[15px]"
          disabled={pending}
          onClick={cancel}
          type="button"
          variant="secondary"
        >
          <XIcon className="opacity-70" />
        </IconButton>

        <div className="flex flex-col gap-2">
          <Label className="leading-5" htmlFor={confirmationId}>
            Type <span className="text-white">DELETE</span> to confirm
          </Label>
          <Input
            autoComplete="off"
            containerClassName="border-dashed"
            disabled={pending}
            id={confirmationId}
            onChange={(event) => setConfirmation(event.target.value)}
            ref={confirmationInput}
            value={confirmation}
          />
          {error === undefined ? null : <FieldMessage error>{error}</FieldMessage>}
          {errorDetails}
        </div>

        <div className="flex flex-col gap-3">
          {retryAction ? (
            <Button
              className="w-full"
              disabled={pending}
              onClick={retryAction.onClick}
              size="lg"
              type="button"
              variant="outline"
            >
              {retryAction.label}
            </Button>
          ) : null}
          <Button
            className="w-full"
            disabled={pending}
            onClick={cancel}
            size="lg"
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            className="w-full"
            disabled={!confirmed || !canConfirm || pending}
            size="lg"
            type="submit"
            variant="destructive"
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export { ConfirmDeletionDialog };
