"use client";

import { type ComponentPropsWithoutRef, useEffect, useRef } from "react";

type DialogProps = Omit<ComponentPropsWithoutRef<"dialog">, "onCancel" | "open"> & {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

function Dialog({ onOpenChange, open, ...props }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    } else if (!open && element.open) {
      if (typeof element.close === "function") element.close();
      else element.removeAttribute("open");
    }
  }, [open]);

  return <dialog
    onCancel={(event) => {
      event.preventDefault();
      onOpenChange(false);
    }}
    ref={dialog}
    {...props}
  />;
}

export { Dialog, type DialogProps };
