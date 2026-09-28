import { useEffect, useRef, type ReactNode } from "react";
import { PassportScreen } from "./passportScreen";

/**
 * A dialog-style card presented as a whole screen, for backup steps and confirmations such as
 * logging out. Each new `title` is a new step: the screen remounts and focus moves to its heading
 * so screen readers announce it.
 */
export function RecoveryScreen({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Each step replaces the whole screen; announce the new heading instead of losing focus.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <PassportScreen key={title} className="gap-6">
      <section className="flex min-w-0 flex-col gap-6 rounded-2xl border border-border bg-popover p-6 sm:p-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold leading-8 outline-none" ref={heading} tabIndex={-1}>
            {title}
          </h1>
          <p className="text-sm leading-5 text-muted-foreground">{description}</p>
        </div>
        {children}
      </section>
    </PassportScreen>
  );
}
