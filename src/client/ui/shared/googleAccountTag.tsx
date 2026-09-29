import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import { GoogleLogo } from "./brand/googleLogo";
import { cn } from "./mergeClassNames";

/**
 * The Google account attached to an identity: the Google mark and the address, never the Google
 * picture, so it reads as "a Google account" and not as the Pubky profile, which is what Passport
 * manages. A long address wraps instead of being cut, so two accounts that differ only in the
 * middle or in the domain stay distinguishable in a narrow row.
 */
export function GoogleAccountTag({
  account,
  className,
}: {
  account: Pick<GoogleAccountProfile, "email">;
  className?: string | undefined;
}) {
  return (
    <span
      aria-label={`Attached Google account: ${account.email}`}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-2xl border border-input bg-black/10 py-0.5 pl-2 pr-2.5 text-xs font-medium leading-5 tracking-normal text-secondary-foreground normal-case",
        className,
      )}
      role="group"
      title={account.email}
    >
      <GoogleLogo className="size-3.5 shrink-0" />
      <span aria-hidden="true" className="min-w-0 [overflow-wrap:anywhere]">
        {account.email}
      </span>
    </span>
  );
}
