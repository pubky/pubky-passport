import { useId, type ReactNode } from "react";

export function IdentityProviderSection({ name, children }: { name: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex w-full min-w-0 flex-col items-start gap-3 border-t border-border pt-6"
    >
      <h3 id={headingId} className="text-lg font-bold">
        {name}
      </h3>
      {children}
    </section>
  );
}
