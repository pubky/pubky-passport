import type { ComponentPropsWithoutRef } from "react";

import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import { GoogleLogo } from "@/client/ui/shared/brand/googleLogo";
import { IdentitySummary } from "@/client/ui/shared/identitySummary";
import { cn } from "@/client/ui/shared/mergeClassNames";

type GoogleAccountCardProps = ComponentPropsWithoutRef<"div"> & {
  account: GoogleAccountProfile;
};

function GoogleAccountCard({ account, className, ...props }: GoogleAccountCardProps) {
  return (
    <div
      className={cn(
        "flex h-18 w-full items-center gap-2 overflow-hidden rounded-2xl bg-card p-4 text-left",
        className,
      )}
      {...props}
    >
      <IdentitySummary
        avatarSrc={account.pictureUrl ?? undefined}
        detail={account.email}
        detailClassName="uppercase leading-4"
        name={account.name}
      />
      <GoogleLogo className="size-4 shrink-0" />
    </div>
  );
}

export { GoogleAccountCard };
