import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "../mergeClassNames";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full border text-sm font-semibold shadow-xs outline-none transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-brand bg-brand/16 text-brand hover:bg-brand/30",
        destructive: "border-transparent bg-destructive-surface text-destructive-foreground hover:bg-destructive",
        ghost: "border-0 bg-transparent text-foreground shadow-none hover:bg-accent active:scale-95 active:bg-accent/80 focus-visible:border-0",
        outline: "border-border bg-input-surface text-foreground hover:bg-accent",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-accent",
      },
      size: {
        default: "h-10 px-4 py-2",
        lg: "h-[60px] px-8 py-5 text-sm font-bold leading-5",
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

export type ButtonProps = ComponentPropsWithoutRef<"button">
  & VariantProps<typeof buttonVariants>;

export type ButtonLinkProps = ComponentPropsWithoutRef<"a">
  & VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size, variant, ...props }, ref) => (
    <button
      className={cn(buttonVariants({ className, size, variant }))}
      ref={ref}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  ({ className, size, variant, ...props }, ref) => (
    <a
      className={cn(buttonVariants({ className, size, variant }))}
      ref={ref}
      {...props}
    />
  ),
);
ButtonLink.displayName = "ButtonLink";
