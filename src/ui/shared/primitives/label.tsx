import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../merge-class-names";

function Label({ className, ...props }: ComponentPropsWithoutRef<"label">) {
  return <label className={cn("text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground", className)} {...props} />;
}

export { Label };
