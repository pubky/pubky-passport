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
