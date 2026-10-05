import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithRef } from "react";

import { cn } from "@/client/ui/shared/mergeClassNames";

import { Spinner } from "./spinner";

/**
 * The large pill's side padding: 32px, halved in a window up to 23rem wide (the app's popup zoomed
 * to 200%) so short labels stay on one line there. One value rather than a pair of breakpoint
 * classes, so a caller's own `px-*` replaces all of it.
 */
export const LARGE_PADDING_X = "px-[clamp(1rem,100vw_-_22rem,2rem)]";

/**
 * Below md (a phone, the app's popup, any window zoomed to 200%) a label that does not fit wraps
 * and its button grows, rather than spilling out of the pill; sizes set the height of one line.
 * From md a label stays on one line, as fixed-width columns there are sized for it. With a touch
 * pointer every size is at least 44px tall, so small secondary actions are easy to hit.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border text-center text-sm font-semibold md:whitespace-nowrap shadow-xs transition-colors disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
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
        // Text actions (skip, finish later, change) that sit on the column edge like the text
        // around them; underlined so they read as actions, not labels.
        link: "text-secondary-foreground decoration-secondary-foreground/50 hover:text-foreground hover:decoration-foreground",
        // A text action that deletes or throws work away, in the error text colour.
        linkDestructive:
          "text-destructive-text decoration-destructive-text/50 hover:decoration-destructive-text",
      },
      size: {
        default: "min-h-10 px-4 py-2 pointer-coarse:min-h-11",
        lg: `min-h-15 text-balance ${LARGE_PADDING_X} py-3 text-sm font-bold leading-5`,
        sm: "min-h-8 px-3.5 py-2 text-xs font-bold leading-4 pointer-coarse:min-h-11",
        icon: "size-10 p-0 pointer-coarse:size-11",
      },
    },
    compoundVariants: [
      {
        // Applied after the size, so a text action stays text-sized whatever size it is given.
        // Touch screens get a 44px target without growing the row on desktop.
        variant: ["link", "linkDestructive"],
        className:
          "h-auto min-h-8 whitespace-normal md:whitespace-normal rounded-sm border-0 bg-transparent px-0 py-1 text-left text-sm font-semibold leading-5 underline underline-offset-4 shadow-none pointer-coarse:min-h-11",
      },
    ],
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
