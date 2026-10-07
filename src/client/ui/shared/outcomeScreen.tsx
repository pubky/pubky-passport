import Image from "next/image";
import type { ReactNode } from "react";

import { cn } from "./mergeClassNames";
import { PassportNavigation } from "./passportNavigation";
import { PassportScreen } from "./passportScreen";
import { DisplayHeading, LeadText } from "./primitives/typography";

/**
 * The one layout for a finished task, such as an attached Google account or an approved sign-in:
 * the display heading, what changed, any detail the person should keep in mind, the checkmark,
 * and the one action that leaves. From md the checkmark sits centred in a card across the track
 * and the action at the track's end, as pubky.app draws a finished step; below md the checkmark
 * stands alone and the action fills the bottom of the window. Failures use ErrorScreen instead.
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
  /** The way on, usually a Done that fills its place. */
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
      <div className="flex justify-center md:rounded-lg md:bg-card md:p-12">
        <Image
          alt=""
          aria-hidden="true"
          className={cn("size-40 md:size-48", compactArt && "size-20")}
          height={192}
          src="/illustrations/checkmark.png"
          width={192}
        />
      </div>
      <PassportNavigation className="mt-auto md:mt-0" confirm={action} />
    </PassportScreen>
  );
}
