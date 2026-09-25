import {
  type FocusEvent,
  type MouseEvent,
  useEffect,
  useId,
  useLayoutEffect,
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
 * click pins it, and Escape, tabbing away, or a press elsewhere closes it; it shifts up only as
 * far as needed to stay inside the viewport. On phones the mark opens a bottom sheet that also
 * offers the sign-in itself. Both hold links, so they are dialogs rather than tooltips.
 */
function ContinueWithGoogle({ onContinue }: { onContinue: () => void }) {
  const desktop = useDesktopBreakpoint();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // A resize or rotation across the breakpoint swaps the explainer's form; the old form's state
  // must not carry over.
  const [seenDesktop, setSeenDesktop] = useState(desktop);
  if (seenDesktop !== desktop) {
    setSeenDesktop(desktop);
    setPinned(false);
    setHovered(false);
    setSheetOpen(false);
  }
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
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
  // Content shown on focus stays while focus is inside it; leaveWithKeyboard closes it then.
  const hide = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      if (panel.current?.contains(document.activeElement)) return;
      setHovered(false);
    }, CLOSE_DELAY_MS);
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
    // Escape dismisses the panel wherever focus is (a mouse click does not focus the mark in
    // WebKit); focus returns to the mark only when nothing outside the control owns it.
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target instanceof Node ? event.target : null;
      const inside = target !== null && root.current?.contains(target) === true;
      const unowned = target === document.body || target === document.documentElement;
      setPinned(false);
      setHovered(false);
      if (!inside && !unowned) return;
      refocusing.current = document.activeElement !== trigger.current;
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [panelOpen]);

  // Keep the mock's top alignment when it fits; otherwise shift the panel up just enough.
  useLayoutEffect(() => {
    if (!panelOpen) return;
    const keepInViewport = () => {
      const element = panel.current;
      if (!element) return;
      element.style.top = "0px";
      const { top, bottom } = element.getBoundingClientRect();
      const overflow = bottom + 16 - window.innerHeight;
      if (overflow > 0) element.style.top = `-${Math.min(overflow, Math.max(top - 16, 0))}px`;
    };
    keepInViewport();
    window.addEventListener("resize", keepInViewport);
    return () => window.removeEventListener("resize", keepInViewport);
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

  function closeSheetOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) setSheetOpen(false);
  }

  return (
    // A flex wrapper blockifies the inline-flex pill, so no line-box gap makes the wrapper taller
    // than the pill and the overlay centres exactly on it.
    <div className="relative flex" onBlur={leaveWithKeyboard} ref={root}>
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
          // the pill's right edge sits at 50vw + 13px on the 588px desktop canvas, and the extra
          // margin covers a classic scrollbar, which vw units include and the canvas does not.
          className="absolute left-full top-0 z-20 w-[432px] max-w-[calc(50vw-24px)] pl-3"
          onMouseEnter={show}
          onMouseLeave={hide}
          ref={panel}
        >
          <div
            aria-labelledby={panelTitleId}
            className="flex flex-col gap-6 rounded-2xl border border-border bg-popover p-8 text-base leading-6 text-muted-foreground shadow-[0_24px_48px_rgba(5,5,10,0.6)] outline-none"
            id={panelId}
            role="dialog"
            tabIndex={-1}
          >
            <h2
              aria-label={TITLE}
              className="text-xl font-bold leading-7 text-foreground"
              id={panelTitleId}
            >
              Continue with Google,
              <br />
              powered by Pubky Passport.
            </h2>
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
        className="mb-0 mt-auto w-full max-w-none rounded-t-2xl border bg-popover p-0 text-base leading-6 text-muted-foreground shadow-[0_50px_100px_rgba(5,5,10,0.75)] backdrop:bg-black/75"
        onClick={closeSheetOnBackdrop}
        onOpenChange={setSheetOpen}
        open={sheetOpen}
      >
        {/* The padding lives inside, so only the backdrop hits the dialog element itself. */}
        <div className="px-6 pb-8 pt-3">
          <button
            aria-label="Close"
            className="mx-auto mb-6 block h-1.5 w-16 rounded-full bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={() => setSheetOpen(false)}
            type="button"
          />
          <div className="flex flex-col gap-6">
            <h2
              aria-label={TITLE}
              className="text-center text-xl font-bold leading-7 text-foreground"
              id={sheetTitleId}
            >
              Continue with Google,
              <br />
              powered by Pubky Passport.
            </h2>
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
