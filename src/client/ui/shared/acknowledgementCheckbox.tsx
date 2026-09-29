import type { ReactNode } from "react";

import { cn } from "./mergeClassNames";

/**
 * A statement the person ticks to confirm what Passport can't see for itself, such as still having
 * a recovery file, before a step that deletes a copy of their key.
 */
function AcknowledgementCheckbox({
  checked,
  children,
  className,
  onCheckedChange,
}: {
  checked: boolean;
  children: ReactNode;
  className?: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className={cn("flex items-start gap-3 text-sm leading-5", className)}>
      <input
        checked={checked}
        className="mt-0.5 size-4 shrink-0 accent-brand"
        onChange={(event) => onCheckedChange(event.currentTarget.checked)}
        type="checkbox"
      />
      {children}
    </label>
  );
}

export { AcknowledgementCheckbox };
