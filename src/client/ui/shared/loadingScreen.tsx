import { Spinner } from "./primitives/spinner";

export function LoadingScreen({ className, label }: { className: string; label: string }) {
  return (
    <main aria-label={label} className={className}>
      <Spinner />
    </main>
  );
}
