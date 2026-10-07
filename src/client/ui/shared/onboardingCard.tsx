import Image from "next/image";
import type { ReactNode } from "react";

import { cn } from "./mergeClassNames";

/**
 * A card with an illustration beside its content from md. `wide` is account creation's card
 * across the wide column, as pubky.app draws it: 48px padding, a 192px illustration from lg and
 * 48px between it and the content.
 */
function OnboardingCard({
  children,
  className,
  illustration,
  size = "compact",
}: {
  children: ReactNode;
  className?: string;
  illustration?: string;
  size?: "compact" | "wide";
}) {
  const wide = size === "wide";
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-6 rounded-lg bg-card p-6 md:flex-row md:items-center",
        wide ? "md:gap-12 md:p-12" : "md:p-8",
        className,
      )}
    >
      {illustration ? (
        <Image
          alt=""
          aria-hidden="true"
          className={cn(
            "hidden shrink-0 object-contain",
            wide ? "size-40 lg:block lg:size-48" : "size-32 md:block",
          )}
          height={wide ? 192 : 128}
          src={illustration}
          width={wide ? 192 : 128}
        />
      ) : null}
      <div className={cn("flex min-w-0 flex-1 flex-col gap-6", wide && "md:max-w-xl")}>
        {children}
      </div>
    </section>
  );
}

export { OnboardingCard };
