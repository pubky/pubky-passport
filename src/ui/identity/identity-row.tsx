import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "../lib/cn";
import { Avatar } from "../components/avatar";
import { GoogleLogo } from "../components/google-logo";

type IdentityRowProps = ButtonHTMLAttributes<HTMLButtonElement> & { avatarSrc?: string; detail: string; name: string; provider?: ReactNode; selected?: boolean };

function IdentityRow({ avatarSrc, className, detail, name, provider, selected, ...props }: IdentityRowProps) {
  const providerMark = provider === "google" ? <GoogleLogo /> : provider;

  return (
    <button aria-pressed={selected} className={cn("relative flex h-[72px] w-full items-center gap-2 rounded-2xl bg-card p-4 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50", selected && "border border-brand/64", className)} type="button" {...props}>
      <Avatar fallback={name} size="sm" {...(avatarSrc ? { src: avatarSrc } : {})} />
      {providerMark && <span className="absolute left-10 top-10 flex size-4 items-center justify-center rounded-full bg-background text-[10px] font-bold shadow-xl">{providerMark}</span>}
      <span className="min-w-0 flex-1"><strong className="block truncate leading-6">{name}</strong><span className="block truncate text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">{detail}</span></span>
      {selected && (
        <svg aria-hidden="true" className="size-4 shrink-0 text-brand" fill="none" viewBox="0 0 16 16">
          <path d="m2.67 8 3.55 3.56 7.11-7.12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
        </svg>
      )}
    </button>
  );
}

export { IdentityRow };
