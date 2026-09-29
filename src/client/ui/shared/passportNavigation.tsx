import type { ReactNode } from "react";

import { cn } from "./mergeClassNames";

/** From md every standard row puts Back in the left column and the forward action in the right. */
const DESKTOP_COLUMNS = "md:grid-cols-(--passport-navigation-columns) md:items-center md:gap-0";

/**
 * A screen's actions, in one order everywhere: Back first (left, or on top when stacked), the
 * forward action last. Two actions share one row from 30rem up, so the forward action stays in
 * view in the app's 520px sign-in popup instead of dropping below a stacked Back; until `sm` the
 * forward action takes the room its longer label needs. `inline` keeps them in one row at every
 * width, for a bar pinned to a phone's window that must stay short. `tertiary` holds side
 * actions such as Finish later or Start over: text actions (Button `link` variants) in a row of
 * their own under the others, on the column's start edge.
 */
function PassportNavigation({
  back,
  className,
  confirm,
  layout = "standard",
  tertiary,
}: {
  back?: ReactNode;
  className?: string;
  confirm?: ReactNode;
  layout?: "standard" | "inline" | "paired";
  tertiary?: ReactNode;
}) {
  const paired = Boolean(back && confirm);
  const columns = layout !== "paired";
  const actions =
    back || confirm ? (
      <div
        className={cn(
          "grid w-full grid-cols-1 gap-4",
          layout === "paired" &&
            "min-[30rem]:grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-2 [&_button]:w-full",
          layout === "standard" &&
            cn(paired && "min-[30rem]:grid-cols-[auto_minmax(0,1fr)] min-[30rem]:gap-3"),
          layout === "inline" && cn(paired && "grid-cols-[auto_minmax(0,1fr)] items-center gap-3"),
          columns && DESKTOP_COLUMNS,
          !tertiary && className,
        )}
      >
        {back ? <div className={cn("w-full", columns && "md:col-start-1")}>{back}</div> : null}
        {confirm ? (
          <div
            className={cn(
              "w-full",
              layout === "standard" && paired && "min-[30rem]:col-start-2",
              layout === "inline" && paired && "col-start-2",
              columns && "md:col-start-3",
            )}
          >
            {confirm}
          </div>
        ) : null}
      </div>
    ) : null;
  if (!tertiary) return actions;
  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      {actions}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1" data-slot="tertiary-actions">
        {tertiary}
      </div>
    </div>
  );
}

export { PassportNavigation };
