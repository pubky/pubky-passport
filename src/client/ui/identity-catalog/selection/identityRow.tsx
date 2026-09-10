import type { ButtonHTMLAttributes } from "react";

import { GoogleLogo } from "../../shared/brand/googleLogo";
import { cn } from "../../shared/mergeClassNames";
import { Avatar } from "../../shared/primitives/avatar";

type IdentityRowProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  avatarSrc?: string;
  detail: string;
  name: string;
  provider?: "google";
  selected?: boolean;
};

function IdentityRow({
  avatarSrc,
  className,
  detail,
  name,
  provider,
  selected,
  style,
  ...props
}: IdentityRowProps) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "relative flex h-[72px] w-full items-center gap-2 rounded-2xl bg-card p-4 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      style={{ ...style, border: selected ? "1px solid rgba(200, 255, 0, 0.64)" : undefined }}
      type="button"
      {...props}
    >
      <Avatar fallback={name} size="sm" {...(avatarSrc ? { src: avatarSrc } : {})} />
      {provider === "google" ? (
        <span className="absolute left-[39px] top-[39px] flex size-4 items-center justify-center drop-shadow-xl">
          <GoogleLogo />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <strong className="block truncate leading-6">{name}</strong>
        <span className="block truncate text-xs font-medium lowercase tracking-[0.1em] text-muted-foreground">
          {detail}
        </span>
      </span>
      {selected ? <CheckIcon /> : null}
    </button>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" className="size-4 shrink-0 text-brand" fill="none" viewBox="0 0 16 16">
      <path
        d="m2.67 8 3.55 3.56 7.11-7.12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export { IdentityRow };
