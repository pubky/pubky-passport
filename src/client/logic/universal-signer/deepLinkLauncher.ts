import "client-only";

import { announceExternalNavigation } from "@/client/logic/authorization/flow/leaveGuard";

/** A phone or tablet: the device that can hand a deep link to an installed Pubky Ring. */
export const COARSE_POINTER_QUERY = "(pointer: coarse)";

/** How long the page may stay in view after a deep link before Passport treats it as not opened. */
export const DEEP_LINK_FALLBACK_MS = 2_000;

/**
 * How a Pubky Ring hand-off starts on this device. `open` tries the deep link first: a coarse
 * pointer means a phone or tablet, where Ring may be installed. `scan` shows the QR code at once:
 * with a fine pointer (a computer, often in the app's popup) the link cannot open Ring and would
 * only show a browser error.
 */
export type RingHandoffMode = "open" | "scan";

export function ringHandoffMode(
  appWindow: Pick<Window, "matchMedia"> | undefined,
): RingHandoffMode {
  try {
    return appWindow?.matchMedia?.(COARSE_POINTER_QUERY).matches ? "open" : "scan";
  } catch {
    return "scan";
  }
}

/**
 * `opening`: the deep link was followed and Passport waits to see whether the page leaves view.
 * `opened`: the page left view, so another app took over. `failed`: the page stayed in view for
 * {@link DEEP_LINK_FALLBACK_MS}, so nothing opened the link and the QR code should take over.
 */
export type DeepLinkLaunchState = "idle" | "opening" | "opened" | "failed";

/**
 * Follows a deep link and reports whether it opened another app, judged by the page leaving
 * view. The link itself is never stored or reported.
 */
export class DeepLinkLauncher {
  private state: DeepLinkLaunchState = "idle";
  private readonly listeners = new Set<() => void>();
  private stopWatching: (() => void) | undefined;

  constructor(
    private readonly appWindow: Window,
    private readonly fallbackMs = DEEP_LINK_FALLBACK_MS,
  ) {}

  getState = (): DeepLinkLaunchState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * Navigates to `target`, a deep link or a function that follows one, from the person's own
   * press: only a navigation the person started lets a browser hand the link to an app.
   */
  launch(target: string | (() => void)): void {
    const settle = this.startWatching();
    announceExternalNavigation(this.appWindow);
    try {
      if (typeof target === "string") this.appWindow.location.assign(target);
      else target();
    } catch {
      // A browser that rejects the scheme outright cannot open it later either.
      settle("failed");
    }
  }

  /**
   * Watches a deep link the person follows through a link of their own: the page leaving view
   * means another app opened it; the page still in view after the fallback delay means none did.
   */
  watch(): void {
    this.startWatching();
  }

  private startWatching(): (state: DeepLinkLaunchState) => void {
    this.stopWatching?.();
    const { appWindow } = this;
    const page = appWindow.document;
    const settle = (next: DeepLinkLaunchState) => {
      stop();
      this.update(next);
    };
    const onVisibilityChange = () => {
      if (page.visibilityState === "hidden") settle("opened");
    };
    const onPageHide = () => settle("opened");
    const timer = appWindow.setTimeout(
      () => settle(page.visibilityState === "hidden" ? "opened" : "failed"),
      this.fallbackMs,
    );
    const stop = () => {
      appWindow.clearTimeout(timer);
      page.removeEventListener("visibilitychange", onVisibilityChange);
      appWindow.removeEventListener("pagehide", onPageHide);
      this.stopWatching = undefined;
    };
    page.addEventListener("visibilitychange", onVisibilityChange);
    appWindow.addEventListener("pagehide", onPageHide);
    this.stopWatching = stop;
    this.update("opening");
    return settle;
  }

  /** Forgets an earlier launch, e.g. when its screen is left. */
  reset(): void {
    this.stopWatching?.();
    this.update("idle");
  }

  dispose(): void {
    this.stopWatching?.();
    this.listeners.clear();
  }

  private update(state: DeepLinkLaunchState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
