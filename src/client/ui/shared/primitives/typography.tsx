import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/client/ui/shared/mergeClassNames";

function DisplayHeading({
  accent,
  accentClassName,
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"h1"> & {
  accent: ReactNode;
  accentClassName?: string;
}) {
  return (
    <h1 className={cn("text-5xl font-bold leading-none", className)} {...props}>
      <span className="block">{children}</span>{" "}
      <span className={cn("block text-brand", accentClassName)}>{accent}</span>
    </h1>
  );
}

function LeadText({ className, ...props }: ComponentPropsWithoutRef<"p">) {
  return (
    <p className={cn("text-xl font-light leading-7 text-muted-foreground", className)} {...props} />
  );
}

export { DisplayHeading, LeadText };
