import { type ReactNode, useId, useState } from "react";

import { XIcon } from "@/client/ui/shared/icons";
import { Dialog } from "@/client/ui/shared/primitives/dialog";
import { IconButton } from "@/client/ui/shared/primitives/iconButton";

/** A separate control, never nested in the provider's sign-in button. */
function ProviderSignInHelp({
  provider,
  purpose = "setup",
  children,
}: {
  provider: "Apple" | "Google";
  purpose?: "setup" | "detach";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const title = `How ${provider} sign-in works`;
  return (
    <div className="relative w-full">
      {children}
      <button
        aria-label={title}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="absolute right-2 top-2 flex size-11 cursor-pointer items-center justify-center rounded-full text-[#8A8A8A] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() => setOpen(true)}
        type="button"
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="8" cy="8" r="6.5" />
          <path d="M6.2 6a1.8 1.8 0 0 1 3.6 0c0 1.3-1.8 1.3-1.8 2.7M8 10.6v.8" />
        </svg>
      </button>
      <Dialog
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="m-auto w-[calc(100%-32px)] max-w-[420px] rounded-2xl border bg-popover p-0 text-base leading-6 text-muted-foreground shadow-xl backdrop:bg-black/75"
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
        onOpenChange={setOpen}
        open={open}
      >
        <div className="flex flex-col gap-4 p-6">
          <h2 className="pr-8 text-xl font-bold text-foreground" id={titleId}>
            {title}
          </h2>
          <IconButton
            aria-label="Close"
            className="absolute right-3 top-3"
            onClick={() => setOpen(false)}
            type="button"
            variant="secondary"
          >
            <XIcon />
          </IconButton>
          <div className="flex flex-col gap-4" id={descriptionId}>
            {provider === "Apple" ? (
              <>
                <p>Apple asks twice. Step 1 of 2: sign in with your Apple Account.</p>
                <p>
                  {purpose === "detach"
                    ? "Step 2 of 2: allow Passport to delete its encrypted key backup from your iCloud."
                    : "Step 2 of 2: allow Passport to keep your encrypted key in your iCloud."}
                </p>
              </>
            ) : (
              <p>
                Your key is encrypted in your browser. The encrypted file is kept in your Google
                Drive, so you can sign in again with your Google Account.
              </p>
            )}
          </div>
        </div>
      </Dialog>
    </div>
  );
}

export { ProviderSignInHelp };
