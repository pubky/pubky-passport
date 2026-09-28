import { type ComponentPropsWithoutRef, useEffect, useRef } from "react";

import { cn } from "./mergeClassNames";
import { SetupProgress } from "./setupProgress";

function PassportScreen({
  className,
  children,
  width = "compact",
  ...props
}: ComponentPropsWithoutRef<"main"> & { width?: "compact" | "wide" }) {
  const screen = useRef<HTMLElement>(null);
  // Children's autoFocus runs first; take focus only when no field on this screen claimed it.
  useEffect(() => {
    if (!screen.current?.contains(document.activeElement))
      screen.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  return (
    <main
      ref={screen}
      tabIndex={-1}
      className={cn(
        "mx-auto flex grow outline-none w-full flex-col px-6 pb-6 pt-3 md:pb-10 md:pt-2",
        width === "wide" ? "max-w-[1280px] md:px-10" : "max-w-[588px] md:px-0",
        className,
      )}
      {...props}
    >
      <SetupProgress />
      {children}
    </main>
  );
}

export { PassportScreen };
