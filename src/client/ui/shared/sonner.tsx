"use client";

import type { CSSProperties } from "react";
import { Toaster } from "sonner";

import { CircleCheckIcon, CircleInfoIcon } from "./icons";

function Sonner() {
  return (
    <Toaster
      duration={3000}
      icons={{
        info: <CircleInfoIcon className="text-[#89898F]" size={20} />,
        success: <CircleCheckIcon className="text-brand" size={20} />,
      }}
      mobileOffset={{ left: 24, right: 24, top: 24 }}
      offset={{ top: 24 }}
      position="top-center"
      style={{ "--width": "392px" } as CSSProperties}
      toastOptions={{
        unstyled: true,
        classNames: {
          content: "flex min-w-0 flex-1 flex-col gap-0.5 break-words",
          description: "w-full text-sm font-normal leading-5 text-secondary-foreground",
          icon: "flex size-5 shrink-0 items-center justify-center",
          info: "!border-[#303034] bg-[linear-gradient(rgba(5,5,10,0.6),rgba(5,5,10,0.6)),linear-gradient(#454549,#454549)]",
          success: "!border-brand/50 bg-brand/25",
          title: "w-full text-sm font-bold leading-5 text-popover-foreground",
          toast:
            "pointer-events-auto flex w-full items-center gap-2 rounded-lg border border-solid p-6 shadow-[0_10px_15px_rgba(5,5,10,0.5)] backdrop-blur-[10px]",
        },
      }}
    />
  );
}

export { Sonner };
