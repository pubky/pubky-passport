import {
  type ReactNode,
  type SubmitEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { XIcon } from "./icons";
import { Button } from "./primitives/button";
import { Dialog } from "./primitives/dialog";
import { FieldMessage } from "./primitives/fieldMessage";
import { IconButton } from "./primitives/iconButton";
import { Input } from "./primitives/input";
import { Label } from "./primitives/label";

const DEFAULT_CONFIRMATION_WORD = "DELETE";

type ConfirmDeletionDialogProps = {
  canConfirm?: boolean;
  confirmLabel: string;
  /** The word the user must type before confirming; defaults to DELETE. */
  confirmationWord?: string;
  description?: ReactNode;
  error?: string | undefined;
  /** Rendered under the error message, e.g. the labeled error-code box. */
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
  confirmationWord = DEFAULT_CONFIRMATION_WORD,
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
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const shownError = useRef(error);
  const confirmed = confirmation === confirmationWord;

  useEffect(() => {
    if (open) confirmationInput.current?.focus();
  }, [open]);

  // A failure that appears while the dialog is open takes focus, so it is read out and the
  // controls that just changed state do not leave focus nowhere.
  useLayoutEffect(() => {
    const appeared = shownError.current === undefined && error !== undefined;
    shownError.current = error;
    if (open && appeared) errorMessage.current?.focus();
  }, [error, open]);

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
  const errorId = `${id}-error`;

  return (
    <Dialog
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) cancel();
      }}
      open={open}
      variant="sheet"
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
            Type <span className="text-white">{confirmationWord}</span> to confirm
          </Label>
          <Input
            aria-describedby={error === undefined ? undefined : errorId}
            autoComplete="off"
            containerClassName="border-dashed"
            id={confirmationId}
            onChange={(event) => setConfirmation(event.target.value)}
            readOnly={pending}
            ref={confirmationInput}
            value={confirmation}
          />
          {error === undefined ? null : (
            <FieldMessage
              className="outline-none"
              error
              id={errorId}
              ref={errorMessage}
              tabIndex={-1}
            >
              {error}
            </FieldMessage>
          )}
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
            disabled={!confirmed || !canConfirm}
            loading={pending}
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
