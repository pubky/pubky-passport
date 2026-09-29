import { PubkyBrandIcon } from "./brand/pubkyBrandIcon";
import { cn } from "./mergeClassNames";

/**
 * Marks an identity whose private key stays in Pubky Ring: Passport cannot sign with it, so its
 * sign-ins are approved in Ring. Styled like the attached Google account tag.
 */
export function RingKeyTag({ className }: { className?: string | undefined }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-input bg-black/10 py-0.5 pl-1.5 pr-2.5 text-xs font-medium leading-5 tracking-normal text-secondary-foreground normal-case",
        className,
      )}
    >
      <PubkyBrandIcon />
      Key in Pubky Ring
    </span>
  );
}
