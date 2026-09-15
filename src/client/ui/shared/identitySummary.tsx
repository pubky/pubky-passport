import type { ReactNode } from "react";

import { cn } from "./mergeClassNames";
import { Avatar } from "./primitives/avatar";

export function IdentitySummary({
  avatarSrc,
  badge,
  detail,
  detailClassName,
  name,
}: {
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
        <span
          className={cn(
            "block truncate text-xs font-medium tracking-[0.1em] text-muted-foreground",
            detailClassName,
          )}
        >
          {detail}
        </span>
      </span>
    </>
  );
}
