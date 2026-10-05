import { createContext, type ReactNode, useContext } from "react";

import { cn } from "./mergeClassNames";
import { PassportScreen } from "./passportScreen";
import { DisplayHeading, LeadText } from "./primitives/typography";
import { SHORT_WINDOW_GAP, SHORT_WINDOW_HEADING } from "./shortWindow";

/**
 * How a hand-off lines up its code, status and actions: centred on a screen of its own, and on the
 * text's start edge inside a card that already names Pubky Ring (`embedded`), so nothing there is
 * indented from the card's title and description.
 */
export type RingHandoffAlignment = "center" | "start";
const RingHandoffAlignmentContext = createContext<RingHandoffAlignment>("center");

/** The alignment of the hand-off this component sits in. */
export function useRingHandoffAlignment(): RingHandoffAlignment {
  return useContext(RingHandoffAlignmentContext);
}

/**
 * The one layout of every screen that hands something over to Pubky Ring (an app's sign-in, a
 * signup, Passport's profile connection, a key export), so each step of a Ring journey reads the
 * same: a heading naming what happens in Pubky Ring, one instruction for what to do there, the
 * hand-off itself (`children`, usually a `RingHandoff`, whose card also says where to get Pubky
 * Ring), a status line for what comes next where the hand-off cannot show it, and the screen's
 * actions. The hand-off decides QR code or link by pointer (see `RingHandoff`); this template only
 * lays the screen out. `embedded` lays the same parts out inside a card that already names Pubky
 * Ring (the start page's), without the screen shell and its heading, on the card text's start
 * edge.
 */
export function RingHandoffScreen({
  accent = "Pubky Ring.",
  action,
  children,
  embedded = false,
  instruction,
  navigation,
  status,
}: {
  /** The heading's accent; a screen about something Ring makes possible names that instead. */
  accent?: string | undefined;
  /** The heading before its accent, e.g. "Sign in with". */
  action: string;
  children: ReactNode;
  /**
   * Inside a card that already names Pubky Ring. `"quiet"` is the card that shows its code with
   * the page, on a computer: the card's own line says what it is for, so the instruction is kept
   * for assistive technology only and the page stays within a 1280x800 window.
   */
  embedded?: boolean | "quiet";
  instruction: ReactNode;
  /** The screen's actions, a `PassportNavigation`. */
  navigation: ReactNode;
  /** A `RingHandoffStatus`, when there is something to do next that the hand-off cannot show. */
  status?: ReactNode;
}) {
  if (embedded)
    return (
      <RingHandoffAlignmentContext value="start">
        <div className="flex min-w-0 flex-col items-start gap-3">
          <p
            className={embedded === "quiet" ? "sr-only" : "text-sm leading-5 text-muted-foreground"}
          >
            {instruction}
          </p>
          {children}
          {status}
          {navigation}
        </div>
      </RingHandoffAlignmentContext>
    );
  return (
    // Tighter in a short window, such as the app's 520x760 popup, so where to get Pubky Ring is
    // still in view below the actions.
    <PassportScreen className={cn("gap-6", SHORT_WINDOW_GAP)}>
      <div className="space-y-3">
        {/* One flowing line where it fits; "Pubky Ring." never breaks apart. In a short window,
            such as the app's 520x760 popup, it is set smaller like the request's own heading, so
            the hand-off and its actions stay in view. */}
        <DisplayHeading
          accent={accent}
          accentClassName="whitespace-nowrap"
          className={cn("[&>span]:inline", SHORT_WINDOW_HEADING)}
        >
          {action}
        </DisplayHeading>
        <LeadText>{instruction}</LeadText>
      </div>
      {children}
      {status}
      {navigation}
    </PassportScreen>
  );
}

/**
 * The hand-off's status line: what comes next where Passport cannot see Pubky Ring (an app's
 * relay it cannot watch, a key export). Nothing says Passport is waiting where it watches itself;
 * the hand-off alone shows that.
 */
export function RingHandoffStatus({ children }: { children: ReactNode }) {
  const alignment = useRingHandoffAlignment();
  return (
    <p
      // Centred under the code or link it is about, or on a card's text edge like the code.
      className={cn(
        "flex items-start gap-2 text-sm leading-5 text-muted-foreground",
        alignment === "start" ? "justify-start text-left" : "justify-center text-center",
      )}
      role="status"
    >
      {children}
    </p>
  );
}
