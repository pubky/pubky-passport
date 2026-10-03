import "client-only";

/** How long after a hand-off to another app an unload still counts as that hand-off. */
const EXTERNAL_NAVIGATION_GRACE_MS = 1_000;
const WEB_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

const externalNavigationUntil = new WeakMap<Window, number>();

/**
 * Marks the next unload as a designed hand-off, not as leaving Passport: a link to another app (a
 * `pubkyauth:`, `pubkyring:` or `lightning:` link), for which browsers may fire `beforeunload`
 * although the page stays open, or the Google sign-in in this window (when the browser blocked
 * Google's pop-up), which saves the request for its return first.
 */
export function announceExternalNavigation(appWindow: Window): void {
  externalNavigationUntil.set(
    appWindow,
    appWindow.performance.now() + EXTERNAL_NAVIGATION_GRACE_MS,
  );
}

/**
 * Whether an app's window opened this page and is still open. That app owns the popup: it closes
 * it when Pubky Ring's session arrives through the relay, at its own deadline or on its own
 * cancel, while Passport still shows the request, and none of those may raise a prompt.
 */
function hasLiveOpener(appWindow: Window): boolean {
  try {
    const opener: unknown = appWindow.opener;
    return opener !== null && opener !== undefined && (opener as Window).closed !== true;
  } catch {
    return false;
  }
}

/**
 * Asks the browser to confirm before the page unloads (a reload, closing the window, Back, a
 * same-window link) while `isPending()` reports a request still waiting for an answer: leaving
 * silently would drop it without telling the app. The request is not kept across a reload (only
 * a Google sign-in in this window saves it, for its own return), so the confirmation is what
 * keeps the person from losing it by accident.
 * A popup whose opener is still open is never guarded: the app that opened it closes it itself,
 * and in a popup the legal links open in a new tab and the logo is inert instead. `isPending` and
 * the opener are read when the unload starts, so a callback navigation that follows a state change
 * in the same task is not prompted. Returns the function that removes the guard.
 */
export function guardPendingRequest(appWindow: Window, isPending: () => boolean): () => void {
  const onClick = (event: MouseEvent) => {
    const target = event.target;
    const link = target instanceof Element ? target.closest("a[href]") : null;
    if (link instanceof HTMLAnchorElement && !WEB_PROTOCOLS.has(link.protocol))
      announceExternalNavigation(appWindow);
  };
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!isPending() || hasLiveOpener(appWindow)) return;
    if (appWindow.performance.now() < (externalNavigationUntil.get(appWindow) ?? 0)) return;
    event.preventDefault();
  };
  appWindow.document.addEventListener("click", onClick, true);
  appWindow.addEventListener("beforeunload", onBeforeUnload);
  return () => {
    appWindow.document.removeEventListener("click", onClick, true);
    appWindow.removeEventListener("beforeunload", onBeforeUnload);
  };
}
