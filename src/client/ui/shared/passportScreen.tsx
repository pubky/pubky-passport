import type { ComponentPropsWithoutRef } from "react";

import { cn } from "./mergeClassNames";

/** One 375px column (24px padding each side) at every width, centred on wide screens. */
function PassportScreen({ className, ...props }: ComponentPropsWithoutRef<"main">) {
  return (
    <main
      className={cn(
        "mx-auto flex w-full max-w-[375px] grow flex-col px-6 pb-10 pt-3 md:pb-12 md:pt-2",
        className,
      )}
      {...props}
    />
  );
}

export { PassportScreen };
