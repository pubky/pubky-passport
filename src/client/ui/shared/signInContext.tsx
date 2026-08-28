import Image from "next/image";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "./mergeClassNames";

function SignInContext({
  className,
  requester,
  ...props
}: ComponentPropsWithoutRef<"aside"> & {
  requester: string;
}) {
  return (
    <aside
      aria-label={`Signing in to ${requester}`}
      className={cn(
        "flex w-fit max-w-full items-center gap-2 self-start rounded-full border border-border bg-card/80 px-3 py-2 text-xs leading-4 shadow-xs",
        className,
      )}
      {...props}
    >
      <Image
        alt=""
        aria-hidden="true"
        className="size-4 shrink-0"
        height={16}
        src="/icons/log-in.svg"
        unoptimized
        width={16}
      />
      <span className="shrink-0 text-muted-foreground">Signing in to</span>
      <bdi className="truncate font-semibold text-foreground">{requester}</bdi>
    </aside>
  );
}

export { SignInContext };
