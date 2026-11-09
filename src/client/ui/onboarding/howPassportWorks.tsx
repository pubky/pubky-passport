import { type MouseEvent, type ReactNode, useId, useState } from "react";

import { XIcon } from "@/client/ui/shared/icons";
import { Dialog } from "@/client/ui/shared/primitives/dialog";
import { IconButton } from "@/client/ui/shared/primitives/iconButton";
import { LeadText } from "@/client/ui/shared/primitives/typography";

const TITLE = "How Passport works";

function explanationPoints(appleEnabled: boolean) {
  const account = appleEnabled ? "Apple or Google account" : "Google account";
  const storage = appleEnabled ? "iCloud or Google Drive" : "Google Drive";
  return [
    {
      term: "Sign-in account:",
      text: `Your ${account} identifies you and keeps your encrypted backup. It does not create or control your pubky.`,
    },
    {
      term: "Your keys:",
      text: `Keys are created in your browser and encrypted before they are stored in ${storage}. Your account provider never sees the private key.`,
    },
    {
      term: "Recovery:",
      text: `Recovery needs both your encrypted backup in ${storage} and a separate recovery key from Passport.`,
    },
    {
      term: "Split security:",
      text: "Passport never gets your backup, and your account provider never gets the key that unlocks it.",
    },
  ];
}

/**
 * The sign-in lead text with a "How?" button at its end. It opens a dialog that explains how
 * Passport keeps a pubky, naming only the providers that are on: a bottom sheet on phones, a
 * centered card from the `md` breakpoint up.
 */
function HowPassportWorks({
  appleEnabled,
  children,
}: {
  appleEnabled: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) setOpen(false);
  }

  return (
    <>
      <LeadText>
        {children}{" "}
        <button
          aria-expanded={open}
          aria-haspopup="dialog"
          className="cursor-pointer rounded-sm font-bold text-brand outline-none hover:underline hover:underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => setOpen(true)}
          type="button"
        >
          How?
        </button>
      </LeadText>
      <Dialog
        aria-labelledby={titleId}
        className="mb-0 mt-auto w-full max-w-none rounded-t-2xl border bg-popover p-0 text-base leading-6 text-muted-foreground shadow-[0_50px_100px_rgba(5,5,10,0.75)] backdrop:bg-black/75 md:m-auto md:max-w-[420px] md:rounded-2xl"
        onClick={closeOnBackdrop}
        onOpenChange={setOpen}
        open={open}
      >
        {/* The padding lives inside, so only the backdrop hits the dialog element itself. */}
        <div className="flex flex-col gap-6 px-6 pb-8 pt-6 md:p-8">
          <h2 className="pr-10 text-xl font-bold leading-7 text-foreground" id={titleId}>
            {TITLE}
          </h2>
          <IconButton
            aria-label="Close"
            className="absolute right-[15px] top-[15px]"
            onClick={() => setOpen(false)}
            type="button"
            variant="secondary"
          >
            <XIcon className="opacity-70" />
          </IconButton>
          <div className="flex flex-col gap-4">
            {explanationPoints(appleEnabled).map((point) => (
              <p key={point.term}>
                <strong className="font-bold text-foreground">{point.term}</strong> {point.text}
              </p>
            ))}
          </div>
        </div>
      </Dialog>
    </>
  );
}

export { HowPassportWorks };
