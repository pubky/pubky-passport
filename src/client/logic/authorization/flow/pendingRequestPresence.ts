import "client-only";

import type { PassportAuthorizationViewState } from "./PassportAuthorizationController";

/** Whether `state` is a request still waiting for its answer: in review or being approved. */
export function isRequestPending(state: PassportAuthorizationViewState | undefined): boolean {
  switch (state?.status) {
    case "review":
    case "preparing":
    case "granting":
    case "completing":
      return true;
    default:
      return false;
  }
}

/**
 * Whether this page holds an app's sign-in request that is still waiting, for the page chrome
 * that lives outside the screen owning the request (the footer's legal links, the logo): while it
 * waits, neither may navigate the page away. `undefined` until the page's authorization controller
 * exists, e.g. before hydration.
 */
export class PendingRequestPresence {
  private pending: boolean | undefined;
  private readonly listeners = new Set<() => void>();

  read = (): boolean | undefined => this.pending;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  publish(pending: boolean): void {
    if (this.pending === pending) return;
    this.pending = pending;
    for (const listener of this.listeners) listener();
  }
}

/** The page's one presence signal, written by the authorization store and read by the chrome. */
export const pendingRequestPresence = new PendingRequestPresence();
