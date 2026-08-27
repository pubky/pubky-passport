import type { ReactNode } from "react";

import { cn } from "./mergeClassNames";

function PassportNavigation({ back, className, confirm }: {
  back?: ReactNode;
  className?: string;
  confirm?: ReactNode;
}) {
  return (
    <div className={cn("grid w-full grid-cols-1 gap-4 md:grid-cols-[120px_1fr_228px] md:items-center md:gap-0", className)}>
      {back ? <div className="w-full md:col-start-1">{back}</div> : null}
      {confirm ? <div className="w-full md:col-start-3">{confirm}</div> : null}
    </div>
  );
}

export { PassportNavigation };
