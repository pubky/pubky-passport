import type { ComponentPropsWithoutRef } from "react";

function RotateCcwIcon(props: ComponentPropsWithoutRef<"svg">) {
  return (
    <svg aria-hidden="true" data-slot="rotate-ccw-icon" fill="none" viewBox="0 0 19.5 19.5" {...props}>
      <path
        d="M.75 9.75c0 1.78.528 3.52 1.517 5s2.394 2.634 4.039 3.315a9 9 0 0 0 5.2.512 9 9 0 0 0 4.608-2.463 9 9 0 0 0 2.463-4.608 9 9 0 0 0-.512-5.2 9 9 0 0 0-3.315-4.039A9 9 0 0 0 9.75.75 9.83 9.83 0 0 0 3.01 3.49L.75 5.75m5 0h-5v-5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export { RotateCcwIcon };
