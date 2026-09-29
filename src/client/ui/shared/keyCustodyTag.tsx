import type { ReactNode } from "react";

import type { LocalIdentityMetadata } from "@/client/logic/local-identity/localIdentityModels";
import { PubkyBrandIcon } from "./brand/pubkyBrandIcon";
import { GoogleAccountTag } from "./googleAccountTag";
import { KeyRoundIcon } from "./icons";
import { cn } from "./mergeClassNames";

/**
 * Where an identity's private key lives, in one tag style wherever identities are listed or
 * confirmed, because it decides what signing in, backing up and logging out do: in Pubky Ring
 * (Passport cannot sign with it; Ring approves), in this browser backed by a Google account (the
 * account's tag), or in this browser alone.
 */
export function KeyCustodyTag({
  className,
  identity,
}: {
  className?: string | undefined;
  identity: Pick<LocalIdentityMetadata, "googleAccount" | "keySource">;
}) {
  if (identity.keySource === "ring")
    return (
      <CustodyTag className={className} icon={<PubkyBrandIcon />}>
        Key in Pubky Ring
      </CustodyTag>
    );
  if (identity.googleAccount)
    return <GoogleAccountTag account={identity.googleAccount} className={className} />;
  return (
    <CustodyTag className={className} icon={<KeyRoundIcon />}>
      Key in this browser
    </CustodyTag>
  );
}

function CustodyTag({
  children,
  className,
  icon,
}: {
  children: ReactNode;
  className?: string | undefined;
  icon: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-2xl border border-input bg-black/10 py-0.5 pl-2 pr-2.5 text-xs font-medium leading-5 tracking-normal text-secondary-foreground normal-case",
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
