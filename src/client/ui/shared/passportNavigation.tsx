import type { ReactNode } from "react";

import { cn } from "./mergeClassNames";

/**
 * A screen's Back and forward actions. Two actions share one row from 30rem up, so the forward
 * action stays in view in the app's 520px sign-in popup instead of dropping below a stacked Back;
 * until `sm` the forward action takes the room its longer label needs.
 */
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
  const paired = Boolean(back && confirm);
  return (
    <div
      className={cn(
        "grid w-full grid-cols-1 gap-4",
        layout === "paired"
          ? "min-[30rem]:grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-2 [&_button]:w-full"
          : cn(
              paired && "min-[30rem]:grid-cols-[auto_minmax(0,1fr)] min-[30rem]:gap-3",
              "md:grid-cols-(--passport-navigation-columns) md:items-center md:gap-0",
            ),
        className,
      )}
    >
      {back ? (
        <div className={cn("w-full", layout === "standard" && "md:col-start-1")}>{back}</div>
      ) : null}
      {confirm ? (
        <div
          className={cn(
            "w-full",
            layout === "standard" && cn(paired && "min-[30rem]:col-start-2", "md:col-start-3"),
          )}
        >
          {confirm}
        </div>
      ) : null}
    </div>
  );
}

export { PassportNavigation };
