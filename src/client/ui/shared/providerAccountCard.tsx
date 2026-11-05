import type { ComponentPropsWithoutRef } from "react";

import type { IdentityProviderAccount } from "@/client/logic/local-identity/localIdentityModels";
import { GoogleLogo } from "@/client/ui/shared/brand/googleLogo";
import { IdentitySummary } from "@/client/ui/shared/identitySummary";
import { cn } from "@/client/ui/shared/mergeClassNames";

type ProviderAccountCardProps = ComponentPropsWithoutRef<"div"> & {
  account: IdentityProviderAccount;
};

/** The sign-in account behind an identity, marked with its provider's logo. */
function ProviderAccountCard({ account, className, ...props }: ProviderAccountCardProps) {
  return (
    <div
      className={cn(
        "flex h-18 w-full items-center gap-2 overflow-hidden rounded-2xl bg-card p-4 text-left",
        className,
      )}
      {...props}
    >
      <IdentitySummary
        avatarSrc={account.googleAccount.pictureUrl ?? undefined}
        detail={account.googleAccount.email}
        detailClassName="uppercase leading-4"
        name={account.googleAccount.name}
      />
      <GoogleLogo className="size-4 shrink-0" />
    </div>
  );
}

export { ProviderAccountCard };
