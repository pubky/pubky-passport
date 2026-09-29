import type { ButtonHTMLAttributes, ReactNode } from "react";

import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import { GoogleAccountTag } from "@/client/ui/shared/googleAccountTag";
import { CheckIcon } from "@/client/ui/shared/icons";
import { IdentitySummary } from "@/client/ui/shared/identitySummary";
import { cn } from "@/client/ui/shared/mergeClassNames";
import { RingKeyTag } from "@/client/ui/shared/ringKeyTag";

type IdentityRowProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  avatarSrc?: string | undefined;
  detail: string;
  googleAccount?: GoogleAccountProfile | undefined;
  /** Notes that the private key lives in Pubky Ring, outside the case-styled key line. */
  keyInRing?: boolean | undefined;
  name: string;
  selected?: boolean;
  /** Shown at the end of the row when it is not the selected one, e.g. a "continue" arrow. */
  trailing?: ReactNode;
};

function IdentityRow({
  avatarSrc,
  className,
  detail,
  googleAccount,
  keyInRing = false,
  name,
  selected,
  trailing,
  ...props
}: IdentityRowProps) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "group flex min-h-18 w-full items-center gap-2 rounded-2xl border border-transparent bg-card px-4 py-3 text-left transition-colors hover:bg-accent aria-pressed:border-brand/64",
        className,
      )}
      type="button"
      {...props}
    >
      <IdentitySummary
        attachment={
          keyInRing ? (
            <RingKeyTag />
          ) : googleAccount ? (
            <GoogleAccountTag account={googleAccount} />
          ) : undefined
        }
        // A tag beside the key keeps rows short, so a list shows more of them.
        attachmentInline
        avatarSrc={avatarSrc}
        detail={detail}
        detailClassName="lowercase group-hover:text-secondary-foreground group-focus-visible:text-secondary-foreground"
        name={name}
      />
      {selected ? <CheckIcon className="text-brand" /> : trailing}
    </button>
  );
}

export { IdentityRow };
