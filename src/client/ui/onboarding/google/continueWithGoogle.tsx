import {
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { GoogleLogo } from "@/client/ui/shared/brand/googleLogo";
import { ArrowRightIcon, CircleHelpIcon, FileTextIcon } from "@/client/ui/shared/icons";
import { Button, ButtonLink } from "@/client/ui/shared/primitives/button";
import { Dialog } from "@/client/ui/shared/primitives/dialog";
import { IconButton } from "@/client/ui/shared/primitives/iconButton";

export const PASSPORT_README_URL = "https://github.com/pubky/pubky-passport/blob/main/README.md";

const CLOSE_DELAY_MS = 150;
const DESKTOP_QUERY = "(min-width: 48rem)";
const TITLE = "Continue with Google, powered by Pubky Passport.";

const POINTS = [
  {
    term: "Google's role:",
    text: "Helps identify you and securely retrieve your encrypted backup. It does not create or control your pubky.",
  },
  {
    term: "Your keys:",
    text: "Keys are created in your browser and encrypted before storage on Google Drive. Google never sees the private key.",
  },
  {
    term: "Recovery:",
    text: "Recovery requires both your encrypted Google Drive backup and a separate recovery key from Passport.",
  },
  {
    term: "Split security:",
    text: "Neither Google nor Passport can recover your pubky on its own, reducing reliance on either one.",
  },
];

/**
 * The "Continue with Google" control: the sign-in pill with a help mark inside it, and the
 * explanation of the split between Google and Passport that the mark opens.
 *
 * The mark is a sibling of the pill, laid over it, so no interactive element nests in another.
 * On desktop the explanation is a panel to the right of the pill: hover and focus show it, a
 * click pins it, and Escape, tabbing away, or a click elsewhere closes it. On phones the mark
 * opens a bottom sheet that also offers the sign-in itself. Both hold links, so they are dialogs
 * rather than tooltips.
 */
function ContinueWithGoogle({ onContinue }: { onContinue: () => void }) {
  const desktop = useDesktopBreakpoint();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const refocusing = useRef(false);
  const labelId = useId();
  const panelId = useId();
  const panelTitleId = useId();
  const sheetTitleId = useId();
  const panelOpen = desktop && (pinned || hovered);

  const cancelClose = () => {
    if (closeTimer.current === undefined) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  };
  const show = () => {
    if (!desktop) return;
    cancelClose();
    setHovered(true);
  };
  // The panel sits a few pixels away from the mark; the delay lets the pointer cross that gap.
  const hide = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHovered(false), CLOSE_DELAY_MS);
  };
  const closePanel = () => {
    cancelClose();
    setPinned(false);
    setHovered(false);
  };

  useEffect(() => cancelClose, []);

  useEffect(() => {
    if (!panelOpen) return;
    const closeOnOutsidePress = (event: Event) => {
      if (!(event.target instanceof Node) || root.current?.contains(event.target)) return;
      setPinned(false);
      setHovered(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [panelOpen]);

  function toggle() {
    cancelClose();
    if (!desktop) {
      setSheetOpen(true);
      return;
    }
    if (pinned) {
      setPinned(false);
      setHovered(false);
    } else {
      setPinned(true);
    }
  }

  // Returning focus after Escape must not count as a focus that shows the panel again.
  function showOnFocus() {
    if (refocusing.current) {
      refocusing.current = false;
      return;
    }
    show();
  }

  function leaveWithKeyboard(event: FocusEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && root.current?.contains(event.relatedTarget)) return;
    closePanel();
  }

  function closeOnEscape(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !panelOpen) return;
    event.stopPropagation();
    closePanel();
    refocusing.current = document.activeElement !== trigger.current;
    trigger.current?.focus();
  }

  function closeSheetOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) setSheetOpen(false);
  }

  return (
    // A flex wrapper blockifies the inline-flex pill, so no line-box gap makes the wrapper taller
    // than the pill and the overlay centres exactly on it.
    <div className="relative flex" onBlur={leaveWithKeyboard} onKeyDown={closeOnEscape} ref={root}>
      <Button
        aria-labelledby={labelId}
        className="w-full"
        onClick={onContinue}
        size="lg"
        type="button"
        variant="secondary"
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 px-8">
        <span aria-hidden="true" className="flex size-5 items-center justify-center">
          <GoogleLogo />
        </span>
        <span
          aria-hidden="true"
          className="text-sm font-bold leading-5 text-secondary-foreground"
          id={labelId}
        >
          Continue with Google
        </span>
        <IconButton
          aria-controls={panelOpen ? panelId : undefined}
          aria-expanded={desktop ? panelOpen : sheetOpen}
          aria-haspopup="dialog"
          aria-label="How Continue with Google works"
          className="pointer-events-auto size-8 text-secondary-foreground/70 hover:bg-transparent hover:text-foreground"
          onClick={toggle}
          onFocus={showOnFocus}
          onMouseEnter={show}
          onMouseLeave={hide}
          ref={trigger}
          type="button"
          variant="ghost"
        >
          <CircleHelpIcon />
        </IconButton>
      </div>

      {panelOpen ? (
        <div
          // 420px card plus its 12px gap, capped so it stays inside the viewport from 768px up:
          // the pill's right edge sits at 50vw + 13px on the 588px desktop canvas.
          className="absolute left-full top-0 z-20 w-[432px] max-w-[calc(50vw-17px)] pl-3"
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          <div
            aria-labelledby={panelTitleId}
            className="flex flex-col gap-6 rounded-2xl border border-border bg-popover p-8 text-base leading-6 text-muted-foreground shadow-[0_24px_48px_rgba(5,5,10,0.6)]"
            id={panelId}
            role="dialog"
          >
            <p
              aria-label={TITLE}
              className="text-xl font-bold leading-7 text-foreground"
              id={panelTitleId}
            >
              Continue with Google,
              <br />
              powered by Pubky Passport.
            </p>
            <ExplanationPoints />
            <ButtonLink
              className="w-full"
              href={PASSPORT_README_URL}
              rel="noopener noreferrer"
              size="lg"
              target="_blank"
              variant="secondary"
            >
              Learn more
            </ButtonLink>
          </div>
        </div>
      ) : null}

      <Dialog
        aria-labelledby={sheetTitleId}
        className="mb-0 mt-auto w-full max-w-none rounded-t-2xl border bg-popover px-6 pb-8 pt-3 text-base leading-6 text-muted-foreground shadow-[0_50px_100px_rgba(5,5,10,0.75)] backdrop:bg-black/75"
        onClick={closeSheetOnBackdrop}
        onOpenChange={setSheetOpen}
        open={sheetOpen}
      >
        <button
          aria-label="Close"
          className="mx-auto mb-6 block h-1.5 w-16 rounded-full bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => setSheetOpen(false)}
          type="button"
        />
        <div className="flex flex-col gap-6">
          <p
            aria-label={TITLE}
            className="text-center text-xl font-bold leading-7 text-foreground"
            id={sheetTitleId}
          >
            Continue with Google,
            <br />
            powered by Pubky Passport.
          </p>
          <ExplanationPoints />
          <div className="flex flex-col gap-3">
            <Button
              className="w-full"
              onClick={() => {
                setSheetOpen(false);
                onContinue();
              }}
              size="lg"
              type="button"
              variant="secondary"
            >
              <ArrowRightIcon />
              Continue with Google
            </Button>
            <ButtonLink
              className="w-full"
              href={PASSPORT_README_URL}
              rel="noopener noreferrer"
              size="lg"
              target="_blank"
              variant="secondary"
            >
              <FileTextIcon />
              Learn more
            </ButtonLink>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function ExplanationPoints() {
  return (
    <div className="flex flex-col gap-4">
      {POINTS.map((point) => (
        <p key={point.term}>
          <strong className="font-bold text-foreground">{point.term}</strong> {point.text}
        </p>
      ))}
    </div>
  );
}

function subscribeToDesktop(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isDesktop(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(DESKTOP_QUERY).matches
  );
}

/** Tailwind's `md` breakpoint; the server and any environment without matchMedia count as a phone. */
function useDesktopBreakpoint(): boolean {
  return useSyncExternalStore(subscribeToDesktop, isDesktop, () => false);
}

export { ContinueWithGoogle };
