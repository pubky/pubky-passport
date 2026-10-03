"use client";

import { Toaster } from "sonner";

import { CircleAlertIcon, CircleCheckIcon, CircleInfoIcon, XIcon } from "./icons";

/** Below the header, so the logo, the sign-in band and the header's action stay in view. */
const BELOW_HEADER = "calc(var(--passport-context-band-height) + var(--passport-header-height))";

function Sonner() {
  return (
    <Toaster
      // Long enough to read a confirmation; failures stay longer and can be closed.
      duration={6000}
      icons={{
        close: <XIcon />,
        error: <CircleAlertIcon className="text-destructive-text" size={20} />,
        info: <CircleInfoIcon className="text-[#89898F]" size={20} />,
        success: <CircleCheckIcon className="text-brand" size={20} />,
      }}
      mobileOffset={{ left: 24, right: 24, top: BELOW_HEADER }}
      offset={{ top: "calc(var(--passport-context-band-height) + 24px)" }}
      position="top-center"
      style={{ "--width": "392px" } as React.CSSProperties}
      toastOptions={{
        unstyled: true,
        classNames: {
          closeButton:
            "order-last -my-2 -mr-2 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-secondary-foreground hover:bg-accent hover:text-foreground",
          content: "flex min-w-0 flex-1 flex-col gap-0.5 break-words",
          description: "w-full text-sm font-normal leading-5 text-secondary-foreground",
          // Every tone tints an opaque base, so a toast over the stepper or a card stays legible
          // instead of letting it show through; the error tint is the Notice's destructive one.
          error:
            "!border-destructive-text/40 bg-[#141419] bg-linear-to-b from-destructive/15 to-destructive/15",
          icon: "flex size-5 shrink-0 items-center justify-center",
          info: "!border-[#303034] bg-[linear-gradient(rgba(5,5,10,0.6),rgba(5,5,10,0.6)),linear-gradient(#454549,#454549)]",
          success: "!border-brand/50 bg-[#141419] bg-linear-to-b from-brand/25 to-brand/25",
          title: "w-full text-sm font-bold leading-5 text-popover-foreground",
          // Sonner's own stylesheet sets a system font on the toaster; the toast takes Passport's.
          toast:
            "pointer-events-auto flex w-full items-center gap-2 rounded-lg border border-solid p-6 font-sans shadow-[0_10px_15px_rgba(5,5,10,0.5)] backdrop-blur-[10px]",
        },
      }}
    />
  );
}

export { Sonner };
