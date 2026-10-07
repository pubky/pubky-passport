import type { ReactNode } from "react";

import { cn } from "./mergeClassNames";
import { PassportScreen } from "./passportScreen";
import { DisplayHeading, LeadText } from "./primitives/typography";

/**
 * One screen of account creation, laid out as pubky.app's onboarding: the heading with its accent
 * and one lead line, then the screen's card or cards across the wide column, then its actions.
 * Below md the screen fills the window under the header, so its actions sit at the window's
 * bottom (the page footer starts below the fold), and they stay pinned there while a long screen
 * scrolls; from md they follow the content. The step it belongs to comes from the surrounding
 * SetupProgressProvider, shown in the header row.
 */
export function OnboardingScreen({
  accent,
  actions,
  children,
  className,
  lead,
  leadFrom,
  title,
  windowTitle,
}: {
  /** The heading's last words, in the brand colour. */
  accent: ReactNode;
  /** A PassportNavigation: Back first, then the way on. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  lead?: ReactNode;
  /** `md`: the lead shows from md only, where a phone's design frame has none (Join). */
  leadFrom?: "md" | undefined;
  /** The heading's first words. */
  title: ReactNode;
  /** The window's title, where the heading's words change with the screen's width. */
  windowTitle?: string | undefined;
}) {
  return (
    <PassportScreen
      className={cn(
        "gap-6 md:gap-8",
        // With actions to pin, a phone's screen fills the window so they sit at its bottom edge;
        // without, the page footer follows the content.
        actions &&
          "max-md:min-h-[calc(100svh-var(--passport-header-height)-var(--passport-context-band-height))]",
        className,
      )}
      width="wide"
    >
      <div className="flex flex-col gap-3 md:gap-4">
        <DisplayHeading accent={accent} className="[&>span]:inline" data-window-title={windowTitle}>
          {title}{" "}
        </DisplayHeading>
        {lead ? (
          <LeadText className={leadFrom === "md" ? "hidden md:block" : undefined}>{lead}</LeadText>
        ) : null}
      </div>
      {children}
      {actions ? <OnboardingActions>{actions}</OnboardingActions> : null}
    </PassportScreen>
  );
}

/**
 * A screen's actions: below md at the window's bottom edge and pinned there while the screen
 * scrolls, so the way on and the way back are always in view; from md right under the content.
 * The page's scroll padding keeps a focused field clear of the bar.
 */
export function OnboardingActions({ children }: { children: ReactNode }) {
  return (
    <div
      className="sticky bottom-0 z-10 -mx-6 mt-auto bg-background/95 px-6 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur md:static md:mx-0 md:mt-0 md:bg-transparent md:p-0 md:backdrop-blur-none"
      data-sticky-actions
    >
      {children}
    </div>
  );
}
