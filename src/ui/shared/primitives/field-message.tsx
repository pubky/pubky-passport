import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../merge-class-names";

function FieldMessage({ className, error = false, ...props }: ComponentPropsWithoutRef<"p"> & { error?: boolean }) {
  return <p className={cn("text-xs leading-4 text-muted-foreground", error && "text-destructive-foreground", className)} {...props} />;
}

export { FieldMessage };
