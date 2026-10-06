import Image from "next/image";
import { useState } from "react";

import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import { GoogleLogo } from "@/client/ui/shared/brand/googleLogo";
import { LinkOffIcon } from "@/client/ui/shared/icons";
import { Button } from "@/client/ui/shared/primitives/button";

/**
 * The Google account attached to an identity, as Manage shows it: the account's picture (the
 * Google mark when it has none or the browser cannot draw it) and its address, with the detach
 * action at the end of the row. The row stacks in a narrow card, so a long address wraps instead
 * of squeezing the button.
 */
function GoogleAccountRow({
  account,
  onDetach,
}: {
  account: Pick<GoogleAccountProfile, "email" | "pictureUrl">;
  onDetach: () => void;
}) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const picture =
    account.pictureUrl && account.pictureUrl !== failedSrc ? account.pictureUrl : undefined;
  return (
    // Sized by the card it sits in, not the window: one row wherever the card has room for it.
    <div className="@container w-full min-w-0">
      <div className="flex w-full min-w-0 flex-col items-start gap-3 @sm:flex-row @sm:items-center @sm:justify-between">
        <div
          aria-label={`Attached Google account: ${account.email}`}
          className="flex min-w-0 items-center gap-3"
          role="group"
        >
          <span className="relative inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
            {picture ? (
              <Image
                key={picture}
                alt=""
                className="object-cover"
                data-testid="google-account-picture"
                fill
                onError={() => setFailedSrc(picture)}
                referrerPolicy="no-referrer"
                sizes="40px"
                src={picture}
                unoptimized
              />
            ) : (
              <GoogleLogo className="size-5" />
            )}
          </span>
          <span
            aria-hidden="true"
            className="min-w-0 text-sm font-medium leading-5 [overflow-wrap:anywhere]"
          >
            {account.email}
          </span>
        </div>
        <Button onClick={onDetach} variant="destructive">
          <LinkOffIcon /> Detach from Google
        </Button>
      </div>
    </div>
  );
}

export { GoogleAccountRow };
