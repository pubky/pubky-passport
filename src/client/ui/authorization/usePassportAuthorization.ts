import { useCallback, useSyncExternalStore } from "react";

import { takeInitialAuthorizationEntry, takeInitialProfileEntry } from "@/instrumentation-client";
import {
  PassportAuthorizationController,
  type PassportAuthorizationViewState,
} from "@/client/logic/authorization/flow/PassportAuthorizationController";
import {
  isRequestPending,
  pendingRequestPresence,
} from "@/client/logic/authorization/flow/pendingRequestPresence";
import {
  usePassportCollaborators,
  type AuthorizationControllerPort,
} from "@/client/ui/passportCollaborators";

export type AuthorizationController = AuthorizationControllerPort;

type PassportAuthorization = {
  controller: AuthorizationController | null;
  state: PassportAuthorizationViewState | undefined;
  /**
   * The page was left while its request waited and came back from the browser's back/forward
   * cache. The request was released when the page was hidden, so nothing on it can answer the app
   * any more.
   */
  closed: boolean;
};

function createBrowserAuthorizationController(): AuthorizationController {
  return PassportAuthorizationController.fromBrowser(
    takeInitialAuthorizationEntry,
    takeInitialProfileEntry,
  );
}

/**
 * Connects React to the page-scoped authorization store without effect timing assumptions.
 * The collaborator factory is consulted only when the page-scoped controller is first created.
 * `fromBrowser` does not read or scrub the address bar; the injected
 * `takeInitialAuthorizationEntry` may still `replaceState` on the first snapshot if Next
 * restored the secret-bearing URL after the pre-hydration scrub.
 */
export function usePassportAuthorization(): PassportAuthorization {
  const { createAuthorizationController } = usePassportCollaborators();
  const create = createAuthorizationController ?? createBrowserAuthorizationController;
  const subscribe = useCallback(
    (listener: () => void) => browserAuthorizationStore.subscribe(listener, create),
    [create],
  );
  const getSnapshot = useCallback(() => browserAuthorizationStore.getSnapshot(create), [create]);
  const state = useSyncExternalStore(subscribe, getSnapshot, () => undefined);
  const closed = useSyncExternalStore(subscribe, browserAuthorizationStore.isClosed, () => false);

  return { controller: browserAuthorizationStore.getController(create), state, closed };
}

/**
 * Owns the page's one controller and disposes it when the page is hidden (`pagehide`), which
 * releases its request. A page the browser then restores from its back/forward cache (`pageshow`
 * with `persisted`) reports `closed` if that request was still waiting, and gets no new
 * controller: the request cannot come back. Publishes whether a request waits to
 * {@link pendingRequestPresence} for the page chrome.
 */
class BrowserAuthorizationStore {
  private controller: AuthorizationController | null = null;
  private unsubscribeController: (() => void) | undefined;
  private readonly listeners = new Set<() => void>();
  private lastState: PassportAuthorizationViewState | undefined;
  private hiddenWhilePending = false;
  private closed = false;
  private windowListenersInstalled = false;

  private readonly hide = () => {
    this.hiddenWhilePending = isRequestPending(this.controller?.getState());
    this.release();
  };

  private readonly show = (event: PageTransitionEvent) => {
    if (!event.persisted || !this.hiddenWhilePending) return;
    this.closed = true;
    this.notify();
  };

  getController = (create: () => AuthorizationController): AuthorizationController | null => {
    if (!this.controller && !this.closed && typeof window !== "undefined") {
      const controller = create();
      this.controller = controller;
      this.hiddenWhilePending = false;
      this.lastState = controller.getState();
      pendingRequestPresence.publish(isRequestPending(this.lastState));
      this.unsubscribeController = controller.subscribe((state) => {
        this.lastState = state;
        pendingRequestPresence.publish(isRequestPending(state));
        this.notify();
      });
      if (!this.windowListenersInstalled) {
        window.addEventListener("pagehide", this.hide);
        window.addEventListener("pageshow", this.show);
        this.windowListenersInstalled = true;
      }
    }
    return this.controller;
  };

  getSnapshot = (
    create: () => AuthorizationController,
  ): PassportAuthorizationViewState | undefined =>
    this.getController(create)?.getState() ?? this.lastState;

  isClosed = (): boolean => this.closed;

  subscribe = (listener: () => void, create: () => AuthorizationController): (() => void) => {
    this.getController(create);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Forgets everything, as a new document would. */
  reset(): void {
    this.release();
    this.hiddenWhilePending = false;
    this.closed = false;
    this.lastState = undefined;
  }

  private release(): void {
    this.unsubscribeController?.();
    this.unsubscribeController = undefined;
    this.controller?.dispose();
    this.controller = null;
    pendingRequestPresence.publish(false);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

const browserAuthorizationStore = new BrowserAuthorizationStore();

/** Starts the next test with a fresh page-scoped store. */
export function resetBrowserAuthorizationStoreForTests(): void {
  browserAuthorizationStore.reset();
}
