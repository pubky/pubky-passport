import type { ReactNode } from "react";

import { copyToClipboard, type CopyToasts } from "./copyToClipboard";
import { CopyIcon } from "./icons";
import { cn } from "./mergeClassNames";
import { IconButton } from "./primitives/iconButton";

/**
 * Labelled read-only value, such as a pubky; `copy` adds a copy button, shown only while there is
 * something to copy (a status such as "Looking up…" in `value` has nothing to copy). The row keeps
 * the button's height while it is hidden, so what follows does not move when a value arrives. The
 * value is one size with or without the button, so two keys in one place always match.
 */
export function DetailField({
  copy,
  label,
  value,
}: {
  copy?: CopyToasts & { value: string | null };
  label: string;
  value: ReactNode;
}) {
  const copyValue = copy?.value ?? null;
  return (
    <div className="w-full min-w-0">
      <p className="mb-1 text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <div className={cn("flex min-w-0 items-center gap-3", copy && "min-h-9")}>
        <p className="min-w-0 flex-1 break-all text-sm font-medium leading-5">{value}</p>
        {copy && copyValue !== null ? (
          <IconButton
            aria-label={`Copy ${label}`}
            className="size-9 p-1"
            onClick={() => void copyToClipboard(copyValue, copy)}
            variant="ghost"
          >
            <CopyIcon size={20} />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}
