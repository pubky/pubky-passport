import Image from "next/image";
import type { ReactNode } from "react";

import { cn } from "./mergeClassNames";

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
        "flex min-w-0 flex-col gap-6 rounded-lg bg-card p-6 md:flex-row md:items-center md:p-8",
        className,
      )}
    >
      {illustration ? (
        <Image
          alt=""
          aria-hidden="true"
          className="hidden size-32 shrink-0 object-contain md:block"
          height={128}
          src={illustration}
          width={128}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
    </section>
  );
}

export { OnboardingCard };
