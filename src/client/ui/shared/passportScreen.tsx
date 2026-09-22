import type { ComponentPropsWithoutRef } from "react";

import { cn } from "./mergeClassNames";

function PassportScreen({ className, ...props }: ComponentPropsWithoutRef<"main">) {
  return (
    <main
      className={cn(
        "mx-auto flex w-full max-w-[375px] grow flex-col px-6 pb-10 pt-3 md:max-w-[588px] md:px-0 md:pb-12 md:pt-2",
        className,
      )}
      {...props}
    />
  );
}

export { PassportScreen };
