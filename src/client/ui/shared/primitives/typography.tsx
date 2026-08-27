import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "../mergeClassNames";

function DisplayHeading({ accent, children, className, ...props }: ComponentPropsWithoutRef<"h1"> & { accent: ReactNode }) {
  return <h1 className={cn("text-5xl font-bold leading-none md:text-6xl", className)} {...props}><span className="block md:inline">{children}</span>{" "}<span className="block text-brand md:inline">{accent}</span></h1>;
}

function LeadText({ className, ...props }: ComponentPropsWithoutRef<"p">) {
  return <p className={cn("text-xl font-light leading-7 text-muted-foreground md:text-2xl md:leading-8", className)} {...props} />;
}

export { DisplayHeading, LeadText };
