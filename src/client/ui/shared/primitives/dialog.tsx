import { type ComponentPropsWithoutRef, useEffect, useRef } from "react";

import { cn } from "@/client/ui/shared/mergeClassNames";

const VARIANTS = {
  /** A confirmation: a sheet along the bottom of a phone's window, a centred 375px card from sm. */
  sheet:
    "mb-0 mt-auto w-full max-w-none rounded-t-xl border bg-popover p-6 text-foreground shadow-[0_50px_100px_rgba(5,5,10,0.75)] backdrop:bg-black/75 sm:m-auto sm:max-w-[375px] sm:rounded-xl",
} as const;

type DialogProps = Omit<ComponentPropsWithoutRef<"dialog">, "onCancel" | "open"> & {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** A shared look; without one, the caller's `className` styles the dialog alone. */
  variant?: keyof typeof VARIANTS;
};

function Dialog({ className, onOpenChange, open, variant, ...props }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // Read before `showModal` moves focus into the dialog.
    const opener = open ? document.activeElement : null;
    if (open && !element.open) {
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
    return () => {
      if (element.open) element.close();
      // Browsers restore focus when a dialog in the page closes, but not when it is unmounted:
      // focus then falls to the page and the next Tab starts again from the top.
      if (!(opener instanceof HTMLElement) || element.contains(opener) || !opener.isConnected)
        return;
      const current = document.activeElement;
      if (current === null || current === document.body || element.contains(current))
        opener.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <dialog
      className={variant ? cn(VARIANTS[variant], className) : className}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      ref={dialog}
      {...props}
    />
  );
}

export { Dialog };
