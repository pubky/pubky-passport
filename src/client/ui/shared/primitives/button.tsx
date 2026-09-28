import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithRef } from "react";

import { cn } from "@/client/ui/shared/mergeClassNames";

import { Spinner } from "./spinner";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full border text-sm font-semibold shadow-xs transition-colors disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-brand bg-brand/16 text-brand hover:bg-brand/30",
        destructive:
          "border-transparent bg-destructive-surface text-destructive-foreground hover:bg-destructive",
        ghost:
          "border-0 bg-transparent text-foreground shadow-none hover:bg-accent active:scale-95 active:bg-accent/80",
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

export type ButtonProps = ComponentPropsWithRef<"button"> &
  VariantProps<typeof buttonVariants> & {
    /**
     * The work this button started is running. A spinner replaces its leading icon and presses
     * are ignored, but it stays focusable at full strength: a natively disabled button would
     * drop keyboard focus to the page and read as unavailable rather than working.
     */
    loading?: boolean;
  };

export type ButtonLinkProps = ComponentPropsWithRef<"a"> & VariantProps<typeof buttonVariants>;

export function Button({
  "aria-disabled": ariaDisabled,
  children,
  className,
  disabled,
  loading = false,
  onClick,
  size,
  type = "button",
  variant,
  ...props
}: ButtonProps) {
  return (
    <button
      aria-busy={loading || undefined}
      aria-disabled={loading || ariaDisabled}
      className={cn(
        buttonVariants({ className, size, variant }),
        loading && "opacity-100! [&>[data-slot=icon]]:hidden",
      )}
      disabled={!loading && disabled}
      // Enter and Space still press an aria-disabled button, and a press would submit its form.
      onClick={loading ? (event) => event.preventDefault() : onClick}
      type={type}
      {...props}
    >
      {loading ? <Spinner decorative /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({ className, size, variant, ...props }: ButtonLinkProps) {
  return <a className={cn(buttonVariants({ className, size, variant }))} {...props} />;
}
