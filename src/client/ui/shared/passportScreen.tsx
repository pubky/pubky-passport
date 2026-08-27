import type { ComponentPropsWithoutRef } from "react";

import { cn } from "./mergeClassNames";

function PassportScreen({ className, ...props }: ComponentPropsWithoutRef<"main">) {
  return <main
    className={cn("mx-auto flex min-h-[calc(100svh-var(--passport-header-height))] w-full max-w-[375px] flex-col px-6 pb-6 pt-3 md:max-w-[588px] md:px-0 md:pb-10 md:pt-2", className)}
    {...props}
  />;
}

export { PassportScreen };
