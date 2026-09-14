import { cn } from "./mergeClassNames";
import { Spinner } from "./primitives/spinner";

export function LoadingScreen({
  className,
  label,
}: {
  className?: string | undefined;
  label: string;
}) {
  return (
    <main aria-label={label} className={cn("grid place-items-center", className)}>
      <Spinner />
    </main>
  );
}
