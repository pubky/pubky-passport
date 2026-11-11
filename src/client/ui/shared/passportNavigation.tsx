import type { ReactNode } from "react";

import { cn } from "./mergeClassNames";

function PassportNavigation({
  back,
  className,
  confirm,
}: {
  back?: ReactNode;
  className?: string;
  confirm?: ReactNode;
}) {
  return (
    <div className={cn("grid w-full grid-cols-1 gap-4", className)}>
      {back ? <div className="w-full">{back}</div> : null}
      {confirm ? <div className="w-full">{confirm}</div> : null}
    </div>
  );
}

export { PassportNavigation };
