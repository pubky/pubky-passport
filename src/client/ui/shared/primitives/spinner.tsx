import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../mergeClassNames";

function Spinner({ className, ...props }: ComponentPropsWithoutRef<"svg">) {
  return (
    <svg
      aria-label="Loading"
      className={cn("size-6 animate-spin", className)}
      fill="none"
      role="status"
      viewBox="0 0 24 24"
      {...props}
    >
      <path
        d="M21 12a9 9 0 1 1-6.219-8.56"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export { Spinner };
