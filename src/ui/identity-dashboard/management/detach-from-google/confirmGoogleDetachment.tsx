"use client";

import { type SubmitEvent, useState } from "react";

import { XIcon } from "../../../shared/icons/actionIcons";
import { Button } from "../../../shared/primitives/button";
import { Dialog } from "../../../shared/primitives/dialog";
import { FieldMessage } from "../../../shared/primitives/fieldMessage";
import { Input } from "../../../shared/primitives/input";
import { Label } from "../../../shared/primitives/label";

const CONFIRMATION = "DELETE";

function ConfirmGoogleDetachment({ canConfirm, canRetryAuthorization, error, onCancel, onConfirm, onRetryAuthorization, open, pending }: {
  canConfirm: boolean;
  canRetryAuthorization: boolean;
  error: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onRetryAuthorization: () => void;
  open: boolean;
  pending: boolean;
}) {
  const [confirmation, setConfirmation] = useState("");
  const confirmed = confirmation === CONFIRMATION;

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

  return (
    <Dialog
      aria-labelledby="detach-google-title"
      className="mb-0 mt-auto w-full max-w-none rounded-t-xl border bg-popover p-6 text-foreground shadow-[0_50px_100px_rgba(5,5,10,0.75)] backdrop:bg-black/75 sm:m-auto sm:max-w-[375px] sm:rounded-xl"
      onOpenChange={(nextOpen) => { if (!nextOpen) cancel(); }}
      open={open}
    >
      <form className="flex flex-col gap-6" onSubmit={submit}>
        <h2 className="pr-10 text-xl font-bold leading-7" id="detach-google-title">Remove Google Access</h2>
        <button aria-label="Close" className="absolute right-[15px] top-[15px] flex size-8 items-center justify-center rounded-full bg-secondary" disabled={pending} onClick={cancel} type="button">
          <XIcon className="opacity-70" />
        </button>

        <div className="flex flex-col gap-2">
          <Label className="leading-5" htmlFor="detach-google-confirmation">Type DELETE to confirm</Label>
          <Input
            autoComplete="off"
            className="border-dashed"
            disabled={pending}
            id="detach-google-confirmation"
            onChange={(event) => setConfirmation(event.target.value)}
            value={confirmation}
          />
          {error ? (
            <FieldMessage error>
              {canRetryAuthorization
                ? "Could not connect to Google. Try again."
                : "Could not remove Google access. Please try again."}
            </FieldMessage>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          {canRetryAuthorization ? (
            <Button className="w-full" disabled={pending} onClick={onRetryAuthorization} size="lg" type="button" variant="outline">
              Try again
            </Button>
          ) : null}
          <Button className="w-full" disabled={pending} onClick={cancel} size="lg" type="button" variant="outline">Cancel</Button>
          <Button className="w-full" disabled={!confirmed || !canConfirm || pending} size="lg" type="submit" variant="destructive">
            {pending ? "Removing…" : "Confirm deletion"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export { ConfirmGoogleDetachment };
