"use client";

import { type ReactNode, useRef } from "react";

import { Button } from "./button";

type ConfirmationDialogProps = {
  actionLabel?: string;
  children?: ReactNode;
  description: string;
  destructive?: boolean;
  title: string;
  triggerLabel: string;
};

function ConfirmationDialog({ actionLabel = "Confirm", children, description, destructive, title, triggerLabel }: ConfirmationDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => ref.current?.close();
  const open = () => ref.current?.showModal();

  return (
    <>
      <Button onClick={open} variant={destructive ? "destructive" : "default"}>{triggerLabel}</Button>
      <dialog className="mb-0 mt-auto w-full max-w-[576px] rounded-t-xl border bg-popover p-6 text-foreground shadow-2xl backdrop:bg-black/75 open:flex open:flex-col open:gap-6 sm:m-auto sm:rounded-2xl sm:p-8" ref={ref}>
        <button aria-label="Close" className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full bg-secondary text-xl text-secondary-foreground" onClick={close}>×</button>
        <header className="pr-10">
          <h2 className="text-xl font-bold leading-7 sm:text-2xl sm:leading-8">{title}</h2>
          <p className="mt-1.5 text-sm font-medium leading-5 text-muted-foreground">{description}</p>
        </header>
        {children}
        <footer className="flex flex-col gap-3 sm:flex-row sm:gap-4">
          <Button className="w-full sm:flex-1" onClick={close} variant="outline">Cancel</Button>
          <Button className="w-full sm:flex-1" onClick={close} variant={destructive ? "destructive" : "default"}>{actionLabel}</Button>
        </footer>
      </dialog>
    </>
  );
}

export { ConfirmationDialog };
