import { useState } from "react";

import { ArrowLeftIcon, ArrowRightIcon, XIcon } from "@/client/ui/shared/icons";
import { Button } from "@/client/ui/shared/primitives/button";

/** The parts of the browser window a request's way out uses; tests pass their own. */
type RequestWindow = Pick<Window, "close" | "closed" | "history" | "location" | "opener">;

/**
 * Whether another window opened this one, as an app opens its sign-in popup. Read once: the
 * opener does not change while a request's screens are shown.
 */
export function useOpenedByApp(target?: Pick<RequestWindow, "opener">): boolean {
  const [opened] = useState(() => {
    try {
      // `window` is read here, inside the try, so a render without one (on the server) is a tab.
      const { opener } = target ?? window;
      return opener !== null && opener !== undefined;
    } catch {
      return false;
    }
  });
  return opened;
}

/**
 * Whether this tab has a page before this one, as it does when an app sent the person here in
 * the same tab. Read once, like the opener.
 */
export function useCameFromPage(target?: Pick<RequestWindow, "history">): boolean {
  const [cameFrom] = useState(() => {
    try {
      return (target ?? window).history.length > 1;
    } catch {
      return false;
    }
  });
  return cameFrom;
}

/** Leaves the request for Passport's own start page, where identity management lives. */
export function goToPassport(target: Pick<RequestWindow, "location"> = window): void {
  target.location.replace("/");
}

/**
 * Closes the app's sign-in popup. A browser lets a page close only a window a script opened; if it
 * refuses, the window goes to Passport's start page rather than leaving the button dead.
 */
export function closeRequestWindow(
  target: Pick<RequestWindow, "close" | "closed" | "location"> = window,
): void {
  try {
    target.close();
    if (target.closed) return;
  } catch {
    // Some embedders throw instead of ignoring the call.
  }
  goToPassport(target);
}

/** How long going back may take before Passport takes it that the tab stayed on this page. */
export const EDIT_LINK_BACK_TIMEOUT_MS = 1000;

/**
 * How long the page stays after telling the app its profile is updated: a window that closes at
 * once can lose the message (WebKit did), or hand it over without its source, which the app must
 * refuse.
 */
export const EDIT_LINK_MESSAGE_DELAY_MS = 1000;

/**
 * Leaves the page an app's edit link opened, once its profile is saved: the window closes where a
 * script may close it (the app's pop-up, or a tab the link opened); otherwise the tab goes back to
 * the page before it (the app, for a link followed in the same tab). Without one, or when going
 * back stays on this page, it ends at Passport's home (`home`).
 */
export function leaveEditLink(
  home: () => void,
  target: Pick<Window, "addEventListener" | "close" | "closed" | "history" | "setTimeout"> = window,
): void {
  try {
    target.close();
    if (target.closed) return;
  } catch {
    // Some embedders throw instead of ignoring the call.
  }
  let back = false;
  try {
    back = target.history.length > 1;
  } catch {
    // Without a readable history there is no page to go back to.
  }
  if (!back) {
    home();
    return;
  }
  let left = false;
  target.addEventListener(
    "pagehide",
    () => {
      left = true;
    },
    { once: true },
  );
  target.history.back();
  target.setTimeout(() => {
    if (!left) home();
  }, EDIT_LINK_BACK_TIMEOUT_MS);
}

/**
 * The way out of a request that has ended. In the app's popup the person closes the window and is
 * back in the app, which never happens by landing on Passport's start page (for a first-time user,
 * its onboarding). In a tab there is no app window to return to, so it names where it goes.
 */
export function RequestExitAction({ inPopup }: { inPopup: boolean }) {
  return inPopup ? (
    <Button className="w-full" onClick={() => closeRequestWindow()} size="lg">
      <XIcon />
      Close window
    </Button>
  ) : (
    <Button className="w-full" onClick={() => goToPassport()} size="lg">
      <ArrowRightIcon />
      Go to Passport
    </Button>
  );
}

/** Back to the page before this tab's request: the app, when it sent the person here. */
export function BackToAppAction({
  target,
}: {
  target?: Pick<RequestWindow, "history"> | undefined;
}) {
  return (
    <Button className="w-full" onClick={() => (target ?? window).history.back()} size="lg">
      <ArrowLeftIcon />
      Back to the app
    </Button>
  );
}

/** Passport's start page as a side action beside the main way out, for fixing things there. */
export function GoToPassportLink() {
  return (
    <Button onClick={() => goToPassport()} variant="link">
      Go to Passport
    </Button>
  );
}
