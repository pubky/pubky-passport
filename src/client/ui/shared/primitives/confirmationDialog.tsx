"use client";

import { type ReactNode, useId, useState } from "react";

import { Button, type ButtonProps } from "./button";
import { Dialog } from "./dialog";

type ConfirmationDialogProps = {
  actionLabel?: string;
  children?: ReactNode;
  description: string;
  destructive?: boolean;
  onConfirm?: () => void;
  title: string;
  triggerClassName?: string;
  triggerLabel: string;
  triggerSize?: ButtonProps["size"];
};

function ConfirmationDialog({ actionLabel = "Confirm", children, description, destructive, onConfirm, title, triggerClassName, triggerLabel, triggerSize }: ConfirmationDialogProps) {
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  const titleId = useId();

  return (
    <>
      <Button className={triggerClassName} onClick={() => setOpen(true)} size={triggerSize} type="button" variant={destructive ? "destructive" : "default"}>{triggerLabel}</Button>
      <Dialog aria-describedby={descriptionId} aria-labelledby={titleId} className="mb-0 mt-auto w-full max-w-[576px] rounded-t-xl border bg-popover p-6 text-foreground shadow-2xl backdrop:bg-black/75 open:flex open:flex-col open:gap-6 sm:m-auto sm:rounded-2xl sm:p-8" onOpenChange={setOpen} open={open}>
        <button aria-label="Close" className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full bg-secondary text-xl text-secondary-foreground" onClick={() => setOpen(false)} type="button">×</button>
        <header className="pr-10">
          <h2 className="text-xl font-bold leading-7 sm:text-2xl sm:leading-8" id={titleId}>{title}</h2>
          <p className="mt-1.5 text-sm font-medium leading-5 text-muted-foreground" id={descriptionId}>{description}</p>
        </header>
        {children}
        <footer className="flex flex-col gap-3 sm:flex-row sm:gap-4">
          <Button className="w-full sm:flex-1" onClick={() => setOpen(false)} type="button" variant="outline">Cancel</Button>
          <Button className="w-full sm:flex-1" onClick={() => { setOpen(false); onConfirm?.(); }} type="button" variant={destructive ? "destructive" : "default"}>{actionLabel}</Button>
        </footer>
      </Dialog>
    </>
  );
}

export { ConfirmationDialog };
