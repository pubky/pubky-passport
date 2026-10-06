import type { ComponentPropsWithRef } from "react";

import { CircleAlertIcon } from "@/client/ui/shared/icons";
import { cn } from "@/client/ui/shared/mergeClassNames";

/**
 * A hint or error under one control. Errors are red with an alert icon, so colour is not the
 * only cue; a failure of a whole form or screen uses `Notice` instead. An error is an alert
 * unless `announce` is false: for text that changes with each keystroke, such as a counter, or
 * an error on a control that focus moves to, which its description already reads out.
 */
function FieldMessage({
  announce = true,
  children,
  className,
  error = false,
  role,
  ...props
}: ComponentPropsWithRef<"p"> & { announce?: boolean; error?: boolean }) {
  return (
    <p
      className={cn(
        "text-xs leading-4 text-muted-foreground",
        error && "flex items-start gap-1.5 text-destructive-text",
        className,
      )}
      role={role ?? (error && announce ? "alert" : undefined)}
      {...props}
    >
      {/* 14px, centred on the first 16px line; long messages wrap beside it. */}
      {error ? (
        <>
          <CircleAlertIcon className="mt-px" size={14} />
          {/* One flex item, so inline markup such as a link stays in the sentence. */}
          <span className="min-w-0">{children}</span>
        </>
      ) : (
        children
      )}
    </p>
  );
}

export { FieldMessage };
