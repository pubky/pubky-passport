import Image from "next/image";
import type { ReactNode } from "react";

import { cn } from "./mergeClassNames";

/**
 * A card across the track with an illustration beside its content, as pubky.app draws account
 * creation's cards: 48px padding from md, a 192px illustration from lg and 48px between it and
 * the content, which keeps to a 576px column so fields and lines stay readable.
 */
function OnboardingCard({
  children,
  className,
  illustration,
}: {
  children: ReactNode;
  className?: string;
  illustration?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-6 rounded-lg bg-card p-6 md:flex-row md:items-center md:gap-12 md:p-12",
        className,
      )}
    >
      {illustration ? (
        <Image
          alt=""
          aria-hidden="true"
          className="hidden size-40 shrink-0 object-contain lg:block lg:size-48"
          height={192}
          src={illustration}
          width={192}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-6 md:max-w-xl">{children}</div>
    </section>
  );
}

export { OnboardingCard };
