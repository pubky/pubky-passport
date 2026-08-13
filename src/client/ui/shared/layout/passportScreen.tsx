import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../mergeClassNames";

function PassportScreen({ className, ...props }: ComponentPropsWithoutRef<"main">) {
  return <main
    className={cn("mx-auto flex min-h-[calc(100svh-84px)] w-full max-w-[375px] flex-col px-6 pb-6 pt-3", className)}
    {...props}
  />;
}

export { PassportScreen };
