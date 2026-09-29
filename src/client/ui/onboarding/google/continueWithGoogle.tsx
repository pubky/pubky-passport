import {
  type FocusEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { DRIVE_PERMISSION_HINT } from "@/client/ui/googleDrivePermissionPrompt";
import { GoogleLogo } from "@/client/ui/shared/brand/googleLogo";
import { ArrowRightIcon, CircleHelpIcon, FileTextIcon } from "@/client/ui/shared/icons";
import { Button, ButtonLink } from "@/client/ui/shared/primitives/button";
import { Dialog } from "@/client/ui/shared/primitives/dialog";
import { IconButton } from "@/client/ui/shared/primitives/iconButton";

export const PASSPORT_README_URL = "https://github.com/pubky/pubky-passport/blob/main/README.md";

/** How long a hover-shown panel outlives the pointer leaving the control. */
const CLOSE_DELAY_MS = 150;
/** How long the pointer may rest on its way to the panel before the panel closes. */
const TRAVEL_REST_MS = 400;
const DESKTOP_QUERY = "(min-width: 48rem)";
/** The 420px card plus the 12px padding that bridges the pointer from the mark to the card. */
const SIDE_PANEL_WIDTH = 432;
const PANEL_GAP = 12;
const VIEWPORT_MARGIN = 16;

type Placement = "right" | "left" | "below" | "above";
type Point = Readonly<{ x: number; y: number }>;

const PLACEMENT_CLASSES: Record<Placement, string> = {
  right: "left-full top-0 w-[432px] pl-3",
  left: "right-full top-0 w-[432px] pr-3",
  below: "right-0 top-full w-[min(420px,calc(100vw-32px))] pt-3",
  above: "right-0 bottom-full w-[min(420px,calc(100vw-32px))] pb-3",
};
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
 * The "Continue with Google" control, with a line under it that tells the person to tick both
 * Drive permissions before Google asks for them.
 */
function ContinueWithGoogle({ onContinue }: { onContinue: () => void }) {
  const hintId = useId();
  return (
    <div className="flex flex-col gap-2">
      <GoogleSignInPill hintId={hintId} onContinue={onContinue} />
      <PermissionHint id={hintId} />
    </div>
  );
}

/**
 * The sign-in pill with a help mark inside it, and the explanation of the split between Google
 * and Passport that the mark opens.
 *
 * The mark is a sibling of the pill, laid over it, so no interactive element nests in another.
 * On desktop the explanation is a panel beside the pill: hovering the mark or focusing it shows
 * it, a click pins it, and Escape, tabbing away, or a press elsewhere closes it. A hover-shown
 * panel stays while the pointer is anywhere in the control (pill, mark or panel) and while it
 * travels from the pill straight towards the panel, so the far side of the pill can be crossed.
 * It opens to the right when the window has room there, else to the left, else below the pill
 * (above it when only that fits), so it never leaves the window; beside the pill it shifts up
 * only as far as needed to stay inside the viewport. On phones the mark opens a bottom sheet that
 * also offers the sign-in itself. Both hold links, so they are dialogs rather than tooltips.
 */
function GoogleSignInPill({
  hintId,
  onContinue,
}: {
  /** The permission hint under the control, which describes every sign-in button. */
  hintId: string;
  onContinue: () => void;
}) {
  const desktop = useDesktopBreakpoint();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>("right");
  // Where the pointer left the control while a hover-shown panel was open.
  const [exit, setExit] = useState<Point | undefined>(undefined);
  // A resize or rotation across the breakpoint swaps the explainer's form; the old form's state
  // must not carry over.
  const [seenDesktop, setSeenDesktop] = useState(desktop);
  if (seenDesktop !== desktop) {
    setSeenDesktop(desktop);
    setPinned(false);
    setHovered(false);
    setSheetOpen(false);
    setExit(undefined);
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
  const sheetHintId = useId();
  const panelOpen = desktop && (pinned || hovered);

  const cancelClose = useCallback(() => {
    if (closeTimer.current === undefined) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);
  const show = () => {
    if (!desktop) return;
    cancelClose();
    setHovered(true);
  };
  // Content shown on focus stays while focus is inside it; leaveWithKeyboard closes it then.
  const hide = useCallback(
    (delay = CLOSE_DELAY_MS) => {
      cancelClose();
      closeTimer.current = setTimeout(() => {
        closeTimer.current = undefined;
        if (panel.current?.contains(document.activeElement)) return;
        setHovered(false);
        setExit(undefined);
      }, delay);
    },
    [cancelClose],
  );
  const closePanel = () => {
    cancelClose();
    setPinned(false);
    setHovered(false);
    setExit(undefined);
  };
  // The panel is inside the control's element, so the pointer moving from the pill onto it never
  // leaves; leaving elsewhere starts the close.
  const enterControl = () => {
    if (!panelOpen) return;
    cancelClose();
    setExit(undefined);
  };
  const leaveControl = (event: MouseEvent<HTMLDivElement>) => {
    if (!panelOpen) return;
    hide();
    setExit({ x: event.clientX, y: event.clientY });
  };

  useEffect(() => cancelClose, [cancelClose]);

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

  // Beside the pill, the pointer can leave it on the way to the panel (a pill as wide as the card
  // puts the panel's far edge a card width from the mark). Each move that heads for the panel from
  // where the pointer left keeps it open; resting or turning away lets it close. A move that
  // arrives inside the control is left to enterControl, which may not have re-rendered yet.
  useEffect(() => {
    if (!panelOpen || exit === undefined) return;
    const followPointer = (event: globalThis.MouseEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return;
      const box = panel.current?.getBoundingClientRect();
      if (!box || !isHeadingForPanel({ x: event.clientX, y: event.clientY }, exit, box)) return;
      hide(TRAVEL_REST_MS);
    };
    document.addEventListener("mousemove", followPointer);
    return () => document.removeEventListener("mousemove", followPointer);
  }, [panelOpen, exit, hide]);

  // Picks the side with room before paint, then nudges the panel inside the viewport. A new
  // placement re-renders first; this effect then runs again for it.
  useLayoutEffect(() => {
    if (!panelOpen) return;
    const keepInViewport = () => {
      const anchor = root.current;
      const element = panel.current;
      if (!anchor || !element) return;
      element.style.top = "";
      element.style.right = "";
      const card = element.firstElementChild ?? element;
      const next = choosePlacement(
        anchor.getBoundingClientRect(),
        card.getBoundingClientRect().height,
      );
      if (next !== placement) {
        setPlacement(next);
        return;
      }
      const { top, bottom, left } = element.getBoundingClientRect();
      if (placement === "right" || placement === "left") {
        // Keep the mock's top alignment when it fits; otherwise shift the panel up just enough.
        const overflow = bottom + VIEWPORT_MARGIN - window.innerHeight;
        if (overflow > 0)
          element.style.top = `-${Math.min(overflow, Math.max(top - VIEWPORT_MARGIN, 0))}px`;
      } else if (left < VIEWPORT_MARGIN) {
        // Right-aligned with the pill; a pill near the left edge pushes the panel right.
        element.style.right = `${left - VIEWPORT_MARGIN}px`;
      }
    };
    keepInViewport();
    window.addEventListener("resize", keepInViewport);
    return () => window.removeEventListener("resize", keepInViewport);
  }, [panelOpen, placement]);

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
    <div
      className="relative flex"
      onBlur={leaveWithKeyboard}
      onMouseEnter={enterControl}
      onMouseLeave={leaveControl}
      ref={root}
    >
      <Button
        aria-describedby={hintId}
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
          aria-label="About signing in with Google"
          className="pointer-events-auto size-8 text-secondary-foreground/70 hover:bg-transparent hover:text-foreground"
          onClick={toggle}
          onFocus={showOnFocus}
          onMouseEnter={show}
          ref={trigger}
          type="button"
          variant="ghost"
        >
          <CircleHelpIcon />
        </IconButton>
      </div>

      {panelOpen ? (
        <div
          className={`absolute z-20 ${PLACEMENT_CLASSES[placement]}`}
          data-placement={placement}
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
            className="mx-auto mb-6 block h-1.5 w-16 rounded-full bg-muted"
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
                aria-describedby={sheetHintId}
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
              <PermissionHint id={sheetHintId} />
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

/**
 * Beside the pill when the window has room for the whole panel on that side, else below it, or
 * above it when only that fits. `clientWidth` leaves out a classic scrollbar; environments
 * without layout report 0 there.
 */
function choosePlacement(anchor: DOMRect, panelHeight: number): Placement {
  const width = document.documentElement.clientWidth || window.innerWidth;
  if (width - anchor.right - VIEWPORT_MARGIN >= SIDE_PANEL_WIDTH) return "right";
  if (anchor.left - VIEWPORT_MARGIN >= SIDE_PANEL_WIDTH) return "left";
  const fitsBelow = anchor.bottom + PANEL_GAP + panelHeight + VIEWPORT_MARGIN <= window.innerHeight;
  const fitsAbove = anchor.top - PANEL_GAP - panelHeight >= VIEWPORT_MARGIN;
  return !fitsBelow && fitsAbove ? "above" : "below";
}

/**
 * Whether `point` lies between `exit`, where the pointer left the control, and the panel's box:
 * inside the convex hull of the two, which is the union of the triangles from `exit` to each side
 * of the box. A straight move from the mark to anything in the panel stays inside it.
 */
function isHeadingForPanel(point: Point, exit: Point, box: DOMRect): boolean {
  const topLeft = { x: box.left, y: box.top };
  const topRight = { x: box.right, y: box.top };
  const bottomRight = { x: box.right, y: box.bottom };
  const bottomLeft = { x: box.left, y: box.bottom };
  const sides = [
    [topLeft, topRight],
    [topRight, bottomRight],
    [bottomRight, bottomLeft],
    [bottomLeft, topLeft],
  ] as const;
  return sides.some(([from, to]) => isInTriangle(point, exit, from, to));
}

/** Point-in-triangle by edge signs; points on an edge count as inside. */
function isInTriangle(point: Point, a: Point, b: Point, c: Point): boolean {
  const side = (from: Point, to: Point) =>
    (to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x);
  const sides = [side(a, b), side(b, c), side(c, a)];
  return !(sides.some((value) => value < 0) && sides.some((value) => value > 0));
}

function PermissionHint({ id }: { id: string }) {
  return (
    <p className="text-balance text-center text-xs leading-4 text-muted-foreground" id={id}>
      {DRIVE_PERMISSION_HINT}
    </p>
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
