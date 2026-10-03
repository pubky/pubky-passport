import { cn } from "./mergeClassNames";

/** A rule with "or" in it, between one way to continue and the alternatives below it. */
export function OrDivider({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex items-center gap-4 text-sm font-medium text-muted-foreground", className)}
    >
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      or
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}
