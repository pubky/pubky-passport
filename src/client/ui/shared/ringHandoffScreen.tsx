import type { ReactNode, Ref } from "react";

import { PubkyRingStoreBadges } from "./brand/pubkyRingStoreBadges";
import { cn } from "./mergeClassNames";
import { PassportScreen } from "./passportScreen";
import { Spinner } from "./primitives/spinner";
import { DisplayHeading, LeadText } from "./primitives/typography";
import { SHORT_WINDOW_GAP, SHORT_WINDOW_HEADING } from "./shortWindow";

/**
 * The one layout of every screen that hands something over to Pubky Ring (an app's sign-in, a
 * signup, Passport's profile connection, a key export), so each step of a Ring journey reads the
 * same: a heading naming what happens in Pubky Ring, one instruction for what to do there, the
 * hand-off itself (`children`, usually a `RingHandoff`), a status line for what happens meanwhile or
 * next, the screen's actions, and where to get Pubky Ring. The hand-off decides QR code or link by
 * pointer (see `RingHandoff`); this template only lays the screen out.
 */
export function RingHandoffScreen({
  action,
  children,
  instruction,
  navigation,
  status,
}: {
  /** The heading before its accent, "Pubky Ring.", e.g. "Sign in with". */
  action: string;
  children: ReactNode;
  instruction: ReactNode;
  /** The screen's actions, a `PassportNavigation`. */
  navigation: ReactNode;
  /** A `RingHandoffStatus`, when there is something to wait for or to do next. */
  status?: ReactNode;
}) {
  return (
    // Tighter in a short window, such as the app's 520x760 popup, so where to get Pubky Ring is
    // still in view below the actions.
    <PassportScreen className={cn("gap-6", SHORT_WINDOW_GAP)}>
      <div className="space-y-3">
        {/* One flowing line where it fits; "Pubky Ring." never breaks apart. In a short window,
            such as the app's 520x760 popup, it is set smaller like the request's own heading, so
            the hand-off and its actions stay in view. */}
        <DisplayHeading
          accent="Pubky Ring."
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
      {/* One row wherever the badges fit beside the question, the popup included. */}
      <div
        className="flex flex-col items-center gap-3 min-[30rem]:flex-row min-[30rem]:justify-between"
        data-slot="ring-install"
      >
        <p className="text-sm font-bold leading-5 text-foreground">Don&apos;t have Pubky Ring?</p>
        <PubkyRingStoreBadges />
      </div>
    </PassportScreen>
  );
}

/**
 * The hand-off's status line. `waiting` adds a spinner, only where Passport itself is waiting for
 * Pubky Ring (a connection it polls); elsewhere Passport cannot see Ring and the line says what
 * comes next. It takes focus programmatically, e.g. once a retried request is waiting again.
 */
export function RingHandoffStatus({
  children,
  ref,
  waiting = false,
}: {
  children: ReactNode;
  ref?: Ref<HTMLParagraphElement> | undefined;
  waiting?: boolean;
}) {
  return (
    <p
      className="flex items-start gap-2 text-sm leading-5 text-muted-foreground outline-none"
      ref={ref}
      role="status"
      tabIndex={-1}
    >
      {waiting ? <Spinner className="mt-0.5 size-4 shrink-0" decorative /> : null}
      {children}
    </p>
  );
}
