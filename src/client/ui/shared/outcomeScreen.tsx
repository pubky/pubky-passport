import Image from "next/image";
import type { ReactNode } from "react";

import { cn } from "./mergeClassNames";
import { PassportScreen } from "./passportScreen";
import { DisplayHeading, LeadText } from "./primitives/typography";

/**
 * The one layout for a finished task, such as an attached Google account or an approved sign-in:
 * the display heading, what changed, any detail the person should keep in mind, the checkmark,
 * and the one action that leaves. Failures use ErrorScreen instead.
 */
export function OutcomeScreen({
  accent,
  action,
  children,
  compactArt = false,
  description,
  label,
  title,
  windowTitle,
}: {
  title: ReactNode;
  accent: ReactNode;
  /** The heading's accessible name when its visible text differs between viewports. */
  label?: string | undefined;
  /**
   * The window title, when the heading's own name would not do as one (it names the app by a
   * label the app chose; see `PassportScreen`).
   */
  windowTitle?: string | undefined;
  description: ReactNode;
  /** What the person should know now, such as the account used or a missing copy. */
  children?: ReactNode;
  /**
   * Draws the checkmark smaller below the desktop breakpoint, for a screen whose details would
   * otherwise push the action below the fold in a phone or an app's popup.
   */
  compactArt?: boolean;
  /** The way on, usually a full-width Done. */
  action: ReactNode;
}) {
  return (
    <PassportScreen className="gap-6 md:gap-8">
      <div className="flex flex-col gap-3">
        <DisplayHeading accent={accent} aria-label={label} data-window-title={windowTitle}>
          {title}
        </DisplayHeading>
        <LeadText>{description}</LeadText>
      </div>
      {children}
      <Image
        alt=""
        aria-hidden="true"
        className={cn("mx-auto size-40 md:size-48", compactArt && "size-20")}
        height={192}
        src="/illustrations/checkmark.png"
        width={192}
      />
      <div className="mt-auto w-full md:mt-0">{action}</div>
    </PassportScreen>
  );
}
