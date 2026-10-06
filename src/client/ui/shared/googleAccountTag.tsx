import Image from "next/image";
import { useState } from "react";

import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import { cn } from "./mergeClassNames";

/**
 * The Google account attached to an identity: the account's round picture (left out when it has
 * none or the browser cannot draw it) and the address. A long address wraps
 * instead of being cut, so two accounts that differ only in the middle or in the domain stay
 * distinguishable in a narrow row. `size="lg"` is the account on a screen that is about it, such
 * as detaching it: a picture large enough to recognise and the address at body size, without the
 * chip, as Manage's Google account row shows it.
 */
export function GoogleAccountTag({
  account,
  className,
  size = "sm",
}: {
  account: Pick<GoogleAccountProfile, "email"> & Partial<Pick<GoogleAccountProfile, "pictureUrl">>;
  className?: string | undefined;
  size?: "sm" | "lg";
}) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const picture =
    account.pictureUrl && account.pictureUrl !== failedSrc ? account.pictureUrl : undefined;
  if (size === "lg")
    return (
      <span
        aria-label={`Attached Google account: ${account.email}`}
        className={cn("inline-flex min-w-0 max-w-full items-center gap-3", className)}
        role="group"
      >
        {picture ? (
          <span className="relative inline-flex size-10 shrink-0 overflow-hidden rounded-full bg-muted">
            <Image
              key={picture}
              alt=""
              className="object-cover"
              data-testid="google-account-tag-picture"
              fill
              onError={() => setFailedSrc(picture)}
              referrerPolicy="no-referrer"
              sizes="40px"
              src={picture}
              unoptimized
            />
          </span>
        ) : null}
        <span
          aria-hidden="true"
          className="min-w-0 text-sm font-medium leading-5 text-foreground [overflow-wrap:anywhere]"
        >
          {account.email}
        </span>
      </span>
    );
  return (
    <span
      aria-label={`Attached Google account: ${account.email}`}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-2xl border border-input bg-black/10 py-0.5 pr-2.5 text-xs font-medium leading-5 tracking-normal text-secondary-foreground normal-case",
        picture ? "pl-1" : "pl-2",
        className,
      )}
      role="group"
      title={account.email}
    >
      {picture ? (
        <span className="relative inline-flex size-4 shrink-0 overflow-hidden rounded-full bg-muted">
          <Image
            key={picture}
            alt=""
            className="object-cover"
            data-testid="google-account-tag-picture"
            fill
            onError={() => setFailedSrc(picture)}
            referrerPolicy="no-referrer"
            sizes="16px"
            src={picture}
            unoptimized
          />
        </span>
      ) : null}
      <span aria-hidden="true" className="min-w-0 [overflow-wrap:anywhere]">
        {account.email}
      </span>
    </span>
  );
}
