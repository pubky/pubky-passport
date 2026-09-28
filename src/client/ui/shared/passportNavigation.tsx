import type { ReactNode } from "react";

import { cn } from "./mergeClassNames";

function PassportNavigation({
  back,
  className,
  confirm,
  layout = "standard",
}: {
  back?: ReactNode;
  className?: string;
  confirm?: ReactNode;
  layout?: "standard" | "paired";
}) {
  return (
    <div
      className={cn(
        "grid w-full grid-cols-1 gap-4",
        layout === "paired"
          ? "sm:grid-cols-2 [&_button]:w-full"
          : "md:grid-cols-(--passport-navigation-columns) md:items-center md:gap-0",
        className,
      )}
    >
      {back ? (
        <div className={cn("w-full", layout === "standard" && "md:col-start-1")}>{back}</div>
      ) : null}
      {confirm ? (
        <div className={cn("w-full", layout === "standard" && "md:col-start-3")}>{confirm}</div>
      ) : null}
    </div>
  );
}

export { PassportNavigation };
