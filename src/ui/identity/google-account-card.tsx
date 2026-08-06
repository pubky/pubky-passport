import type { ComponentPropsWithoutRef } from "react";

import type { GoogleAccountProfile } from "../../core/identity/googleAccountProfile";
import { Avatar } from "../shared/primitives/avatar";
import { GoogleLogo } from "../shared/brand/google-logo";
import { cn } from "../shared/merge-class-names";

type GoogleAccountCardProps = ComponentPropsWithoutRef<"div"> & {
  account: GoogleAccountProfile;
};

function GoogleAccountCard({ account, className, ...props }: GoogleAccountCardProps) {
  return (
    <div className={cn("flex h-[72px] w-full items-center gap-2 overflow-hidden rounded-2xl bg-card p-4 text-left", className)} {...props}>
      <Avatar fallback={account.name} size="sm" {...(account.pictureUrl ? { src: account.pictureUrl } : {})} />
      <span className="min-w-0 flex-1">
        <strong className="block truncate leading-6">{account.name}</strong>
        <span className="block truncate text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground">{account.email}</span>
      </span>
      <GoogleLogo className="size-4 shrink-0" />
    </div>
  );
}

export { GoogleAccountCard };
