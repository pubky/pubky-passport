import type { ButtonHTMLAttributes } from "react";

import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import { GoogleAccountTag } from "@/client/ui/shared/googleAccountTag";
import { CheckIcon } from "@/client/ui/shared/icons";
import { IdentitySummary } from "@/client/ui/shared/identitySummary";
import { cn } from "@/client/ui/shared/mergeClassNames";

type IdentityRowProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  avatarSrc?: string | undefined;
  detail: string;
  googleAccount?: GoogleAccountProfile | undefined;
  /** Notes that the private key lives in Pubky Ring, outside the case-styled key line. */
  keyInRing?: boolean | undefined;
  name: string;
  selected?: boolean;
};

function IdentityRow({
  avatarSrc,
  className,
  detail,
  googleAccount,
  keyInRing = false,
  name,
  selected,
  ...props
}: IdentityRowProps) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "group flex min-h-18 w-full items-center gap-2 rounded-2xl border border-transparent bg-card p-4 text-left transition-colors hover:bg-accent aria-pressed:border-brand/64",
        className,
      )}
      type="button"
      {...props}
    >
      <IdentitySummary
        attachment={
          keyInRing ? (
            <span className="text-xs font-medium leading-4 text-muted-foreground">
              Key in Pubky Ring
            </span>
          ) : googleAccount ? (
            <GoogleAccountTag account={googleAccount} />
          ) : undefined
        }
        avatarSrc={avatarSrc}
        detail={detail}
        detailClassName="lowercase group-hover:text-secondary-foreground group-focus-visible:text-secondary-foreground"
        name={name}
      />
      {selected ? <CheckIcon className="text-brand" /> : null}
    </button>
  );
}

export { IdentityRow };
