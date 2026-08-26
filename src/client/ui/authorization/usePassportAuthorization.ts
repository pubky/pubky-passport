import { useSyncExternalStore } from "react";

import {
  PassportAuthorizationController,
  type PassportAuthorizationViewState,
} from "../../logic/authorization/flow/PassportAuthorizationController";

type PassportAuthorization = {
  controller: PassportAuthorizationController | null;
  state: PassportAuthorizationViewState | undefined;
};

/** Connects React to the page-scoped authorization store without effect timing assumptions. */
export function usePassportAuthorization(): PassportAuthorization {
  const state = useSyncExternalStore(
    browserAuthorizationStore.subscribe,
    browserAuthorizationStore.getSnapshot,
    () => undefined,
  );

  return { controller: browserAuthorizationStore.getController(), state };
}

function createBrowserAuthorizationStore() {
  let controller: PassportAuthorizationController | null = null;
  let pagehideListenerInstalled = false;
  const dispose = () => {
    controller?.dispose();
    controller = null;
    pagehideListenerInstalled = false;
  };
  const getController = () => {
    if (!controller && typeof window !== "undefined") {
      controller = PassportAuthorizationController.fromBrowser();
      if (!pagehideListenerInstalled) {
        window.addEventListener("pagehide", dispose, { once: true });
        pagehideListenerInstalled = true;
      }
    }
    return controller;
  };

  return {
    dispose,
    getController,
    getSnapshot: () => getController()?.getState(),
    subscribe: (listener: () => void) => getController()?.subscribe(() => listener())
      ?? (() => undefined),
  };
}

const browserAuthorizationStore = createBrowserAuthorizationStore();
