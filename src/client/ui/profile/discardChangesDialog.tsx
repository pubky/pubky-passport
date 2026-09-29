import { useEffect, useId, useRef } from "react";

import { Button } from "@/client/ui/shared/primitives/button";
import { Dialog } from "@/client/ui/shared/primitives/dialog";

/**
 * Asked when Back would leave the profile editor with changes that were never published. Keep
 * editing comes first and takes focus, so Enter or Escape never throws the changes away.
 */
export function DiscardChangesDialog({
  onDiscard,
  onKeepEditing,
  open,
}: {
  onDiscard: () => void;
  onKeepEditing: () => void;
  open: boolean;
}) {
  const id = useId();
  const keepEditing = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) keepEditing.current?.focus();
  }, [open]);
  return (
    <Dialog
      aria-describedby={`${id}-description`}
      aria-labelledby={`${id}-title`}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onKeepEditing();
      }}
      open={open}
      variant="sheet"
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-bold leading-7" id={`${id}-title`}>
            Discard your changes?
          </h2>
          <p className="text-sm leading-5 text-muted-foreground" id={`${id}-description`}>
            Your changes are not published yet. Going back throws them away.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <Button
            className="w-full"
            onClick={onKeepEditing}
            ref={keepEditing}
            size="lg"
            variant="outline"
          >
            Keep editing
          </Button>
          <Button className="w-full" onClick={onDiscard} size="lg" variant="destructive">
            Discard changes
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
