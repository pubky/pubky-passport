import { cn } from "./mergeClassNames";
import { Spinner } from "./primitives/spinner";

/**
 * What the page shows until Passport can render a screen, including the server-rendered first
 * paint: a centred spinner that says what it waits for, so a slow load never reads as a blank page.
 */
export function LoadingScreen({
  className,
  label,
  message = "Opening Passport…",
}: {
  className?: string | undefined;
  /** The page's heading while loading, for assistive technology. */
  label: string;
  message?: string | undefined;
}) {
  return (
    <main
      aria-busy="true"
      aria-label={label}
      className={cn(
        "flex min-h-[calc(100svh-var(--passport-header-height)-var(--passport-context-band-height))] w-full grow flex-col items-center justify-center gap-4 px-6 pb-[var(--passport-header-height)]",
        className,
      )}
    >
      <h1 className="sr-only">{label}</h1>
      <Spinner className="size-8 text-brand" decorative />
      <p className="text-sm font-medium leading-5 text-muted-foreground" role="status">
        {message}
      </p>
    </main>
  );
}
