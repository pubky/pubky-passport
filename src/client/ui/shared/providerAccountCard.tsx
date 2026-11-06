import type { ComponentPropsWithoutRef } from "react";

import type { IdentityProviderAccount } from "@/client/logic/local-identity/localIdentityModels";
import { AppleAccountLabel } from "@/client/ui/shared/appleAccountLabel";
import { GoogleLogo } from "@/client/ui/shared/brand/googleLogo";
import { IdentitySummary } from "@/client/ui/shared/identitySummary";
import { cn } from "@/client/ui/shared/mergeClassNames";

type ProviderAccountCardProps = ComponentPropsWithoutRef<"div"> & {
  account: IdentityProviderAccount;
};

/**
 * The sign-in account behind an identity: Google's with its logo, an Apple Account named in text
 * (the Apple logo belongs only in the Sign in with Apple button).
 */
function ProviderAccountCard({ account, className, ...props }: ProviderAccountCardProps) {
  return (
    <div
      className={cn(
        "flex h-18 w-full items-center gap-2 overflow-hidden rounded-2xl bg-card p-4 text-left",
        className,
      )}
      {...props}
    >
      {account.provider === "google" ? (
        <>
          <IdentitySummary
            avatarSrc={account.googleAccount.pictureUrl ?? undefined}
            detail={account.googleAccount.email}
            detailClassName="uppercase leading-4"
            name={account.googleAccount.name}
          />
          <GoogleLogo className="size-4 shrink-0" />
        </>
      ) : (
        <>
          {/* Apple sends the name only once and has no profile picture: without a name the
              card shows the email alone, and without either it names the account type. */}
          <IdentitySummary
            detail={
              account.appleAccount.name && account.appleAccount.email
                ? account.appleAccount.email
                : "Key stored in iCloud"
            }
            detailClassName="uppercase leading-4"
            name={account.appleAccount.name ?? account.appleAccount.email ?? "Apple Account"}
          />
          {account.appleAccount.name || account.appleAccount.email ? <AppleAccountLabel /> : null}
        </>
      )}
    </div>
  );
}

export { ProviderAccountCard };
