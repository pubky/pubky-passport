import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import { GoogleLogo } from "./brand/googleLogo";
import { cn } from "./mergeClassNames";
import { Avatar } from "./primitives/avatar";

/**
 * The Google account attached to an identity. It stays small and carries the Google mark so its
 * picture and email never read as the Pubky profile, which is what Passport manages.
 */
export function GoogleAccountTag({
  account,
  className,
}: {
  account: Pick<GoogleAccountProfile, "email" | "pictureUrl">;
  className?: string | undefined;
}) {
  return (
    <span
      aria-label={`Attached Google account: ${account.email}`}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-input bg-black/10 py-0.5 pl-0.5 pr-2.5 text-xs font-medium leading-5 tracking-normal text-secondary-foreground normal-case",
        className,
      )}
      role="group"
    >
      <span aria-hidden="true" className="relative flex shrink-0">
        <Avatar
          className="size-5 text-[8px]"
          fallback={account.email}
          src={account.pictureUrl ?? undefined}
        />
        <span className="absolute -bottom-0.5 -right-1 flex size-3 items-center justify-center rounded-full bg-card">
          <GoogleLogo className="size-2" />
        </span>
      </span>
      <span aria-hidden="true" className="truncate">
        {account.email}
      </span>
    </span>
  );
}
