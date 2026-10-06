import type { ComponentPropsWithRef } from "react";

import { cn } from "@/client/ui/shared/mergeClassNames";

/**
 * A multi-line text field that looks and behaves like `Input`: the same box, focus outline,
 * dimming while disabled and red border while invalid. It grows with its text up to a few lines,
 * then scrolls; where the browser cannot size it to its content it keeps its resize handle instead.
 */
function Textarea({ className, ...props }: ComponentPropsWithRef<"textarea">) {
  return (
    <textarea
      className={cn(
        "block min-h-26 max-h-44 w-full resize-y rounded-lg border border-input bg-black/10 py-4 pl-6 pr-5 text-base font-medium leading-6 text-foreground shadow-xs [field-sizing:content] placeholder:text-muted-foreground supports-[field-sizing:content]:resize-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
