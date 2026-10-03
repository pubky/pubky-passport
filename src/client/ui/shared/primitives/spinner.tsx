import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/client/ui/shared/mergeClassNames";

/**
 * A progress indicator. On its own it is a `status` named "Loading"; `decorative` hides it from
 * assistive technology where visible text already says what is happening, such as a busy button.
 * It stops turning when the person asks for reduced motion.
 */
function Spinner({
  className,
  decorative = false,
  ...props
}: ComponentPropsWithoutRef<"svg"> & { decorative?: boolean }) {
  return (
    <svg
      {...(decorative ? { "aria-hidden": true } : { "aria-label": "Loading", role: "status" })}
      className={cn("size-6 animate-spin motion-reduce:animate-none", className)}
      data-slot="spinner"
      fill="none"
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
