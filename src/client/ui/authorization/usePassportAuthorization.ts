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

class BrowserAuthorizationStore {
  private controller: PassportAuthorizationController | null = null;
  private pagehideListenerInstalled = false;

  dispose = () => {
    this.controller?.dispose();
    this.controller = null;
    this.pagehideListenerInstalled = false;
  };

  getController = (): PassportAuthorizationController | null => {
    if (!this.controller && typeof window !== "undefined") {
      this.controller = PassportAuthorizationController.fromBrowser();
      if (!this.pagehideListenerInstalled) {
        window.addEventListener("pagehide", this.dispose, { once: true });
        this.pagehideListenerInstalled = true;
      }
    }
    return this.controller;
  };

  getSnapshot = (): PassportAuthorizationViewState | undefined => this.getController()?.getState();

  subscribe = (listener: () => void): (() => void) => this.getController()
    ?.subscribe(() => listener()) ?? (() => undefined);
}

const browserAuthorizationStore = new BrowserAuthorizationStore();
