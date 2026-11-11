import Image from "next/image";
import { useEffect, useId, useRef, useState, type RefObject } from "react";

import { Button } from "@/client/ui/shared/primitives/button";
import { Dialog } from "@/client/ui/shared/primitives/dialog";

export type HelpPoint = { term: string; text: string };

const ACCOUNT_HELP_POINTS: HelpPoint[] = [
  {
    term: "Your provider:",
    text: "Your account provider helps you sign in and find your encrypted backup. It does not create or control your pubky.",
  },
  {
    term: "Your keys:",
    text: "Your keys are created in your browser and encrypted before they are saved in your cloud storage.",
  },
  {
    term: "Recovery:",
    text: "When you sign in, Passport retrieves your encrypted backup and the separate key needed to unlock it.",
  },
  {
    term: "Split security:",
    text: "Your encrypted backup and the key that unlocks it are stored separately.",
  },
];

/** A useful in-app guide, shared by every provider without relying on an external link. */
const PASSPORT_GUIDE: HelpPoint[] = [
  {
    term: "In this browser:",
    text: "Passport creates your pubky keys in your browser and keeps the identity on this device. Signing in to an app asks you to approve its requested access.",
  },
  {
    term: "In cloud storage:",
    text: "Your account holds an encrypted backup. Passport verifies your sign-in before supplying the separate key needed to unlock it. Your account provider is trusted to identify you.",
  },
  {
    term: "On another device:",
    text: "On a new device, sign in with the same account to retrieve and unlock the backup. Keep access to that account to restore your pubky.",
  },
  {
    term: "Your recovery options:",
    text: "In identity management you can download a password-protected recovery file, move your key to Pubky Ring, or detach your account after saving a backup.",
  },
];

/** Native modal focus containment, with the Figma sheet geometry and a real dismiss handle. */
function SignInHelpDrawer({
  continueLabel = "Continue",
  disabled = false,
  onContinue,
  onOpenChange,
  open,
  points = ACCOUNT_HELP_POINTS,
  returnFocus,
  title = "Continue with your account,",
}: {
  continueLabel?: string;
  disabled?: boolean;
  onContinue?: (() => void) | undefined;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  points?: HelpPoint[];
  returnFocus: RefObject<HTMLButtonElement | null>;
  title?: string;
}) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [details, setDetails] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    heading.current?.focus({ preventScroll: true });
    const dialog = heading.current?.closest("dialog");
    if (dialog) dialog.scrollTop = 0;
  }, [open, details]);

  function close(restoreFocus: boolean) {
    // Close synchronously: a provider callback may open a popup in this very same click.
    heading.current?.closest("dialog")?.close();
    onOpenChange(false);
    setDetails(false);
    if (restoreFocus) returnFocus.current?.focus();
  }

  return (
    <Dialog
      aria-labelledby={titleId}
      className="fixed inset-x-0 bottom-0 top-auto m-0 mx-auto max-h-[calc(100dvh-16px)] w-full max-w-[375px] overflow-y-auto overscroll-contain rounded-t-2xl border-0 bg-[#1d1d20] p-0 text-[#89898f] shadow-[0_20px_25px_rgba(5,5,10,0.5),0_8px_10px_rgba(5,5,10,0.25)] backdrop:bg-black/75 md:inset-y-0 md:my-auto md:max-h-[calc(100dvh-48px)] md:rounded-2xl"
      onClick={(event) => {
        if (event.target === event.currentTarget) close(true);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const actions =
          event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        const first = actions[0];
        const last = actions[actions.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === heading.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onOpenChange={() => close(true)}
      open={open}
    >
      <div>
        <div className="relative h-[22px]">
          <button
            aria-label="Close"
            className="absolute left-1/2 top-0 h-11 w-20 -translate-x-1/2 cursor-pointer rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={() => close(true)}
            type="button"
          >
            <span className="absolute left-1/2 top-4 h-1.5 w-15 -translate-x-1/2 rounded-full bg-[#303034]" />
          </button>
        </div>
        <header className="p-6">
          <h2
            className="text-center text-lg font-semibold leading-[18px] text-white outline-none"
            id={titleId}
            ref={heading}
            tabIndex={-1}
          >
            {details ? (
              "How Passport works"
            ) : (
              <>
                {title} <br />
                powered by Pubky Passport.
              </>
            )}
          </h2>
        </header>
        <div className="flex flex-col gap-2 px-12 text-sm font-medium leading-5">
          {(details ? PASSPORT_GUIDE : points).map((point) => (
            <p key={point.term}>
              <strong className="font-bold text-[#d4d4db]">{point.term}</strong> {point.text}
            </p>
          ))}
        </div>
        <footer className="flex flex-col gap-4 p-6">
          <Button
            className="w-full border-0"
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              close(false);
              onContinue?.();
            }}
            size="lg"
            variant="secondary"
          >
            <Image alt="" aria-hidden="true" height={16} src="/icons/arrow-right.svg" width={16} />
            {continueLabel}
          </Button>
          <Button
            className="w-full border-0"
            onClick={() => setDetails(!details)}
            size="lg"
            variant="secondary"
          >
            <Image alt="" aria-hidden="true" height={16} src="/icons/file-text.svg" width={16} />
            {details ? "Back to overview" : "Learn more"}
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}

export { ACCOUNT_HELP_POINTS, SignInHelpDrawer };
