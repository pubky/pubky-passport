import type { ReactNode, Ref } from "react";

import { CircleCheckIcon, TriangleAlertIcon } from "@/client/ui/shared/icons";
import { cn } from "@/client/ui/shared/mergeClassNames";

/** A backup date in the viewer's locale, such as "Sep 29, 2026". */
export function formatBackupDate(at: Date): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(at);
}

/**
 * One line of what protects a key: `ok` for a backup that can bring it back, `warning` for none
 * or one never checked. The icon repeats the tone, so colour is not the only cue.
 */
export function BackupStatusLine({
  children,
  className,
  ref,
  tabIndex,
  tone,
}: {
  children: ReactNode;
  className?: string;
  /** For a line that takes focus once it replaces the control that was used. */
  ref?: Ref<HTMLParagraphElement> | undefined;
  tabIndex?: number | undefined;
  tone: "ok" | "warning";
}) {
  return (
    <p
      className={cn("flex min-w-0 items-start gap-2 text-sm leading-5 outline-none", className)}
      ref={ref}
      tabIndex={tabIndex}
    >
      {tone === "ok" ? (
        <CircleCheckIcon className="mt-0.5 shrink-0 text-brand" size={16} />
      ) : (
        <TriangleAlertIcon className="mt-0.5 shrink-0 text-warning" size={16} />
      )}
      <span className="min-w-0">{children}</span>
    </p>
  );
}
