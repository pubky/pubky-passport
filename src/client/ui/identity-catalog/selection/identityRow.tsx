import type { ButtonHTMLAttributes, ReactNode } from "react";

import { GoogleLogo } from "@/client/ui/shared/brand/googleLogo";
import { CheckIcon } from "@/client/ui/shared/icons";
import { IdentitySummary } from "@/client/ui/shared/identitySummary";
import { cn } from "@/client/ui/shared/mergeClassNames";

type IdentityRowProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  avatarSrc?: string | undefined;
  detail: string;
  name: string;
  provider?: ReactNode | undefined;
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
  const googleProvider = provider === "google";
  const providerMark = googleProvider ? <GoogleLogo /> : provider;

  return (
    <button
      aria-pressed={selected}
      className={cn(
        "flex h-[72px] w-full items-center gap-2 rounded-2xl border border-transparent bg-card p-4 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:border-brand/64",
        className,
      )}
      type="button"
      {...props}
    >
      <IdentitySummary
        avatarSrc={avatarSrc}
        badge={googleProvider ? providerMark : undefined}
        detail={detail}
        detailClassName="lowercase"
        name={name}
      />
      {selected ? (
        <CheckIcon className="text-brand" />
      ) : !googleProvider && providerMark ? (
        <span className="flex size-4 shrink-0 items-center justify-center">{providerMark}</span>
      ) : null}
    </button>
  );
}

export { IdentityRow };
