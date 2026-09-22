import { useCallback, useSyncExternalStore } from "react";

import { takeInitialAuthorizationEntry } from "@/instrumentation-client";
import {
  PassportAuthorizationController,
  type PassportAuthorizationViewState,
} from "@/client/logic/authorization/flow/PassportAuthorizationController";
import {
  usePassportCollaborators,
  type AuthorizationControllerPort,
} from "@/client/ui/passportCollaborators";

export type AuthorizationController = AuthorizationControllerPort;

type PassportAuthorization = {
  controller: AuthorizationController | null;
  state: PassportAuthorizationViewState | undefined;
};

function createBrowserAuthorizationController(): AuthorizationController {
  return PassportAuthorizationController.fromBrowser(takeInitialAuthorizationEntry);
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

  return { controller: browserAuthorizationStore.getController(create), state };
}

class BrowserAuthorizationStore {
  private controller: AuthorizationController | null = null;
  private pagehideListenerInstalled = false;

  dispose = () => {
    this.controller?.dispose();
    this.controller = null;
    this.pagehideListenerInstalled = false;
  };

  getController = (create: () => AuthorizationController): AuthorizationController | null => {
    if (!this.controller && typeof window !== "undefined") {
      this.controller = create();
      if (!this.pagehideListenerInstalled) {
        window.addEventListener("pagehide", this.dispose, { once: true });
        this.pagehideListenerInstalled = true;
      }
    }
    return this.controller;
  };

  getSnapshot = (
    create: () => AuthorizationController,
  ): PassportAuthorizationViewState | undefined => this.getController(create)?.getState();

  subscribe = (listener: () => void, create: () => AuthorizationController): (() => void) =>
    this.getController(create)?.subscribe(() => listener()) ?? (() => undefined);
}

const browserAuthorizationStore = new BrowserAuthorizationStore();
