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
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
    return () => {
      if (element.open) element.close();
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

export { Dialog, type DialogProps };
