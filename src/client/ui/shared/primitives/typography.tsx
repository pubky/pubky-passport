import type { ComponentPropsWithoutRef, ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "@/client/ui/shared/mergeClassNames";

/**
 * The longest line running text takes on a screen's wide track (a lead, a notice or a paragraph
 * between cards): about 70 characters of a lead, so a sentence never runs across the whole 1200px.
 */
const TEXT_MEASURE = "max-w-3xl";

function DisplayHeading({
  accent,
  accentClassName,
  children,
  className,
  desktopAccentOnNewLine = false,
  ...props
}: ComponentPropsWithRef<"h1"> & {
  accent: ReactNode;
  accentClassName?: string;
  desktopAccentOnNewLine?: boolean;
}) {
  return (
    <h1
      className={cn(
        // Below md the size follows the window, so the longest word ("Authorization") fits the
        // column from 360px down to a 520px popup zoomed to 200%; a longer word breaks.
        // It takes focus when its screen opens, only ever programmatically (see PassportScreen).
        "text-[length:clamp(1.75rem,calc((100vw_-_3rem)/6.4),3rem)] font-bold leading-none outline-none [overflow-wrap:break-word] md:text-6xl",
        className,
      )}
      tabIndex={-1}
      {...props}
    >
      <span className="block md:inline">{children}</span>{" "}
      <span
        className={cn(
          "block text-brand",
          desktopAccentOnNewLine ? "md:block" : "md:inline",
          accentClassName,
        )}
      >
        {accent}
      </span>
    </h1>
  );
}

/** A screen's lead, under its heading, kept to `TEXT_MEASURE`. */
function LeadText({ className, ...props }: ComponentPropsWithoutRef<"p">) {
  return (
    <p
      className={cn(
        "text-xl font-light leading-7 text-muted-foreground md:text-2xl md:leading-8",
        TEXT_MEASURE,
        className,
      )}
      {...props}
    />
  );
}

export { DisplayHeading, LeadText, TEXT_MEASURE };
