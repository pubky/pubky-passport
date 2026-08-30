"use client";

import Image from "next/image";
import { Toaster, toast } from "sonner";

function Sonner() {
  return (
    <Toaster
      duration={3000}
      icons={{
        info: (
          <Image
            alt=""
            aria-hidden="true"
            height={20}
            src="/icons/sonner-info.svg"
            unoptimized
            width={20}
          />
        ),
        success: (
          <Image
            alt=""
            aria-hidden="true"
            height={20}
            src="/icons/sonner-success.svg"
            unoptimized
            width={20}
          />
        ),
      }}
      mobileOffset={{ left: 24, right: 24, top: 24 }}
      offset={{ top: 24 }}
      position="top-center"
      style={{ "--width": "392px" } as React.CSSProperties}
      toastOptions={{
        unstyled: true,
        classNames: {
          content: "flex min-w-0 flex-1 flex-col gap-0.5 break-words",
          default: "!border-brand/50 bg-brand/25",
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

function showCopyConfirmation(label: string, value: string) {
  if (label === "Homeserver") {
    toast("Homeserver copied");
    return;
  }

  toast(`${label} copied to clipboard`, { description: shortCopiedValue(value) });
}

function shortCopiedValue(value: string): string {
  return value.length > 32 ? `${value.slice(0, 32)}...` : value;
}

function showDownloadConfirmation() {
  toast.success("File downloaded");
}

export { showCopyConfirmation, showDownloadConfirmation, Sonner };
