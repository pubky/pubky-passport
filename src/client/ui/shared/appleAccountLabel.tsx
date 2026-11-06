import { cn } from "./mergeClassNames";

/**
 * Marks an identity that signs in with an Apple Account. Text only: Apple's guidelines allow the
 * Apple logo only inside a Sign in with Apple button, so account screens name the account.
 */
function AppleAccountLabel({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 whitespace-nowrap text-xs font-medium uppercase leading-4 tracking-[0.1em] text-muted-foreground",
        className,
      )}
    >
      Apple Account
    </span>
  );
}

export { AppleAccountLabel };
