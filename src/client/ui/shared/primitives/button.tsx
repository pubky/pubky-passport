import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithRef } from "react";

import { cn } from "@/client/ui/shared/mergeClassNames";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full border text-sm font-semibold shadow-xs outline-none transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-brand bg-brand/16 text-brand hover:bg-brand/30",
        destructive:
          "border-transparent bg-destructive-surface text-destructive-foreground hover:bg-destructive",
        ghost:
          "border-0 bg-transparent text-foreground shadow-none hover:bg-accent active:scale-95 active:bg-accent/80 focus-visible:border-0",
        outline: "border-border bg-input-surface text-foreground hover:bg-accent",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-accent",
      },
      size: {
        default: "h-10 px-4 py-2",
        lg: "h-15 px-8 py-5 text-sm font-bold leading-5",
        sm: "h-8 px-3.5 py-2 text-xs font-bold leading-4",
        icon: "size-10 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = ComponentPropsWithRef<"button"> & VariantProps<typeof buttonVariants>;

export type ButtonLinkProps = ComponentPropsWithRef<"a"> & VariantProps<typeof buttonVariants>;

export function Button({ className, size, type = "button", variant, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ className, size, variant }))} type={type} {...props} />
  );
}

export function ButtonLink({ className, size, variant, ...props }: ButtonLinkProps) {
  return <a className={cn(buttonVariants({ className, size, variant }))} {...props} />;
}
