import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../mergeClassNames";

function Spinner({ className, ...props }: ComponentPropsWithoutRef<"svg">) {
  return (
    <svg aria-label="Loading" className={cn("size-6 animate-spin", className)} fill="none" role="status" viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeLinecap="round" strokeWidth="2" strokeDasharray="42 15" />
    </svg>
  );
}

export { Spinner };
