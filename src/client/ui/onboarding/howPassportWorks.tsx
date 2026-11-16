import { type ReactNode, useRef, useState } from "react";

import { LeadText } from "@/client/ui/shared/primitives/typography";
import { SignInHelpDrawer } from "./signInHelpDrawer";

/** The shared explanation stays the same for every set of enabled account providers. */
function HowPassportWorks({
  children,
  onContinue,
}: {
  children: ReactNode;
  onContinue?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <>
      <LeadText>
        {children}{" "}
        <button
          aria-expanded={open}
          aria-haspopup="dialog"
          className="cursor-pointer rounded-sm font-bold text-brand underline-offset-4 hover:underline focus-visible:underline outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => setOpen(true)}
          ref={trigger}
          type="button"
        >
          How?
        </button>
      </LeadText>
      <SignInHelpDrawer
        onContinue={onContinue}
        onOpenChange={setOpen}
        open={open}
        returnFocus={trigger}
      />
    </>
  );
}

export { HowPassportWorks };
