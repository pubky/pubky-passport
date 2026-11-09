import type { ButtonHTMLAttributes } from "react";

import { AppleLogo } from "@/client/ui/shared/brand/appleLogo";
import { GoogleLogo } from "@/client/ui/shared/brand/googleLogo";
import { CheckIcon } from "@/client/ui/shared/icons";
import { IdentitySummary } from "@/client/ui/shared/identitySummary";
import { cn } from "@/client/ui/shared/mergeClassNames";

type IdentityRowProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  avatarSrc?: string | undefined;
  detail: string;
  name: string;
  provider?: "google" | "apple" | undefined;
  selected?: boolean;
};

function IdentityRow({
  avatarSrc,
  className,
  detail,
  name,
  provider,
  selected,
  ...props
}: IdentityRowProps) {
  const providerBadge =
    provider === "google" ? <GoogleLogo /> : provider === "apple" ? <AppleLogo /> : undefined;

  return (
    <button
      aria-pressed={selected}
      className={cn(
        "flex min-h-18 w-full items-center gap-2 rounded-2xl border border-transparent bg-card p-4 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:border-brand/64",
        className,
      )}
      type="button"
      {...props}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1 md:flex-row md:items-center md:gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <IdentitySummary
            avatarSrc={avatarSrc}
            badge={providerBadge}
            detail={detail}
            detailClassName="lowercase"
            name={name}
          />
        </span>
      </div>
      {selected ? <CheckIcon className="text-brand" /> : null}
    </button>
  );
}

export { IdentityRow };
