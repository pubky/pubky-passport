import type { ReactNode } from "react";

import { cn } from "./mergeClassNames";
import { Avatar } from "./primitives/avatar";

export function IdentitySummary({
  attachment,
  attachmentInline = false,
  avatarSrc,
  badge,
  detail,
  detailClassName,
  name,
}: {
  /** Rendered under the detail line, e.g. an attached Google account. */
  attachment?: ReactNode | undefined;
  /** Puts the attachment on the detail line, wrapping under it only when the row is narrow. */
  attachmentInline?: boolean | undefined;
  avatarSrc?: string | undefined;
  badge?: ReactNode | undefined;
  detail: string;
  detailClassName?: string | undefined;
  name: string;
}) {
  return (
    <>
      <span className="relative flex shrink-0">
        <Avatar fallback={name} size="sm" src={avatarSrc} />
        {badge ? (
          <span className="absolute bottom-px right-px flex size-4 items-center justify-center drop-shadow-xl">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate leading-6">{name}</strong>
        {attachment && attachmentInline ? (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "shrink-0 text-xs font-medium tracking-[0.1em] text-muted-foreground",
                detailClassName,
              )}
            >
              {detail}
            </span>
            <span className="flex min-w-0">{attachment}</span>
          </span>
        ) : (
          <>
            <span
              className={cn(
                "block truncate text-xs font-medium tracking-[0.1em] text-muted-foreground",
                detailClassName,
              )}
            >
              {detail}
            </span>
            {attachment ? <span className="mt-1 flex min-w-0">{attachment}</span> : null}
          </>
        )}
      </span>
    </>
  );
}
