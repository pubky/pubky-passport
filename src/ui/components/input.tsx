import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { cn } from "../lib/cn";

type InputProps = ComponentPropsWithoutRef<"input"> & { action?: ReactNode };

const Input = forwardRef<HTMLInputElement, InputProps>(({ action, className, ...props }, ref) => (
  <div className={cn("flex h-[60px] items-center gap-3 overflow-hidden rounded-lg border border-input bg-black/10 pl-6 pr-5 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30 has-[:disabled]:opacity-50 has-[[aria-invalid=true]]:border-destructive", className)}>
    <input className="min-w-0 flex-1 bg-transparent text-base font-medium leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed" ref={ref} {...props} />
    {action}
  </div>
));
Input.displayName = "Input";

export { Input };
export type { InputProps };
