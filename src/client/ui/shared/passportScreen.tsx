import { type ComponentPropsWithoutRef, useEffect, useRef } from "react";

import { cn } from "./mergeClassNames";
import { SetupProgress } from "./setupProgress";

const APP_TITLE = "Pubky Passport";

/**
 * One step of Passport. Every step lays out on the same track as pubky.app's onboarding: from md
 * the header row's 40px inset on either side, up to a 1200px content track (1280px with the
 * inset), its heading on the track's start edge under the logo; below md, such as on a phone or in
 * an app's 520px sign-in popup, 24px from the window's sides. Cards take the track's width and
 * their content's height; running text keeps to `TEXT_MEASURE`.
 *
 * When it appears, focus moves to its heading (unless a field on it claimed focus first), so
 * screen readers announce the step by name, and the window title names the step too: in the app's
 * sign-in popup the title is the window's only label. A heading whose name alone would not do as
 * that label (an app-supplied one) gives the title in `data-window-title`.
 */
function PassportScreen({ className, children, ...props }: ComponentPropsWithoutRef<"main">) {
  const screen = useRef<HTMLElement>(null);
  // Children's effects run first; take focus only when nothing on this screen claimed it. A
  // heading opts in to programmatic focus with tabindex; the screen itself is the fallback.
  useEffect(() => {
    const main = screen.current;
    if (main && !main.contains(document.activeElement))
      (main.querySelector<HTMLElement>("h1[tabindex]") ?? main).focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  // The title follows the heading, which can change while the screen stays. The layout's own
  // title can land after the first screen (its metadata streams in), so it is overridden then too.
  useEffect(() => {
    const main = screen.current;
    if (!main) return;
    const update = () => {
      const title = screenTitle(main);
      if (document.title !== title) document.title = title;
    };
    update();
    const observer = new MutationObserver(update);
    const changes = { characterData: true, childList: true, subtree: true };
    observer.observe(main, { ...changes, attributeFilter: ["aria-label", "data-window-title"] });
    observer.observe(document.head, changes);
    return () => {
      observer.disconnect();
      document.title = APP_TITLE;
    };
  }, []);
  return (
    <main
      ref={screen}
      tabIndex={-1}
      className={cn(
        "mx-auto flex w-full max-w-[1280px] grow flex-col px-6 pb-6 pt-3 outline-none md:px-10 md:pb-10 md:pt-2",
        className,
      )}
      {...props}
    >
      <SetupProgress />
      {children}
    </main>
  );
}

/**
 * "Your pubky | Pubky Passport": the heading's own window title, or else its accessible name
 * without its full stop.
 */
function screenTitle(main: HTMLElement): string {
  const heading = main.querySelector("h1");
  const name = (
    heading?.getAttribute("data-window-title") ??
    (heading?.getAttribute("aria-label") ?? heading?.textContent ?? "").replace(/\.\s*$/u, "")
  )
    .replace(/\s+/gu, " ")
    .trim();
  return name ? `${name} | ${APP_TITLE}` : APP_TITLE;
}

export { PassportScreen };
