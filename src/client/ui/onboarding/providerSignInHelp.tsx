import Image from "next/image";
import { type ReactNode, useRef, useState } from "react";

import { ACCOUNT_HELP_POINTS, SignInHelpDrawer, type HelpPoint } from "./signInHelpDrawer";

/** Detaching deletes both copies, so its help must explain the destructive purpose. */
const APPLE_DETACH_HELP_POINTS: HelpPoint[] = [
  {
    term: "Apple’s role:",
    text: "Sign in with the Apple Account that holds your encrypted backup.",
  },
  {
    term: "Your keys:",
    text: "Allow Passport to delete its encrypted key backup from your iCloud.",
  },
  {
    term: "Recovery:",
    text: "Keep a recovery file before detaching. Passport removes the iCloud backup and this browser’s copy.",
  },
  {
    term: "After detaching:",
    text: "Apple sign-in can no longer restore this pubky.",
  },
];

/** A separate keyboard action, with its visible icon eight pixels after the sign-in title. */
function ProviderSignInHelp({
  provider,
  purpose = "setup",
  disabled = false,
  onContinue,
  children,
}: {
  provider: "Apple" | "Google";
  purpose?: "setup" | "detach";
  disabled?: boolean;
  onContinue: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const label = `Continue with ${provider}`;

  return (
    <div className="relative grid w-full">
      {children}
      <div className="pointer-events-none col-start-1 row-start-1 flex items-center justify-center text-sm font-bold leading-5">
        {/* Match the intrinsic title width. The extra 20px of hit area extends to the right,
            keeping the 44px help target clear of the visible title and the centered icon row. */}
        <div className="flex translate-x-2.5 items-center">
          <span aria-hidden="true" className="invisible whitespace-nowrap pl-6">
            {label}
          </span>
          <button
            aria-label={`How ${provider} sign-in works`}
            aria-expanded={open}
            aria-haspopup="dialog"
            className="pointer-events-auto flex size-11 cursor-pointer items-center rounded-full pl-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={() => setOpen(true)}
            ref={trigger}
            type="button"
          >
            <Image alt="" aria-hidden="true" height={16} src="/icons/circle-help.svg" width={16} />
          </button>
        </div>
      </div>
      <SignInHelpDrawer
        continueLabel={label}
        disabled={disabled}
        onContinue={onContinue}
        onOpenChange={setOpen}
        open={open}
        points={
          provider === "Apple" && purpose === "detach"
            ? APPLE_DETACH_HELP_POINTS
            : ACCOUNT_HELP_POINTS
        }
        returnFocus={trigger}
        title={`${label},`}
      />
    </div>
  );
}

export { ProviderSignInHelp };
