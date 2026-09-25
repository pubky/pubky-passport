import type { Result } from "better-result";
import { useEffect, useState, useSyncExternalStore } from "react";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";
import type { GoogleIdentityViewState } from "@/client/logic/google-identity/GoogleIdentityController";
import { useGoogleIdentityConfiguration } from "./googleIdentityConfiguration";
import {
  usePassportCollaborators,
  type GoogleIdentityControllerPort,
} from "./passportCollaborators";

type GoogleIdentityOperation = (
  controller: GoogleIdentityControllerPort,
) => Promise<Result<unknown, GoogleIdentityViewError>>;
type GoogleIdentityOperationName =
  | "detach"
  | "establish"
  | "replace-invalid-file"
  | "replace-undecryptable-file"
  | "continue-without-visible-backup";
type GoogleIdentityScreen = "establishment" | "detachment";

const IDLE_STATE: GoogleIdentityViewState = { status: "idle" };
const OPERATION_FAILED_STATE: GoogleIdentityViewState = {
  status: "failed",
  error: { code: "operation_failed" },
};

/**
 * Bridges one screen-scoped Google identity controller to React.
 *
 * The controller is constructed on the first operation so server rendering and idle
 * screens never load browser dependencies. The controller publishes its own states;
 * this store only adds a generic `operation_failed` state for construction failures,
 * rejected operation promises, and input a screen rejects through {@link fail}.
 */
class GoogleIdentityStore {
  private controller: GoogleIdentityControllerPort | null = null;
  private failure: GoogleIdentityViewState | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly createController: () => GoogleIdentityControllerPort,
    private readonly screen: GoogleIdentityScreen,
  ) {}

  getSnapshot = (): GoogleIdentityViewState =>
    this.failure ?? this.controller?.getState() ?? IDLE_STATE;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Starts one controller operation; its Result is published by the controller itself. */
  run = (name: GoogleIdentityOperationName, operation: GoogleIdentityOperation): void => {
    const controller = this.ensureController();
    if (!controller) return;
    this.setFailure(null);
    operation(controller).catch((e: unknown) => {
      LOGGER.warn(`identity.google.${this.screen}_ui.failed`, {
        operation: name,
        stage: "operation_promise",
        ...safeErrorLogFields(e),
      });
      if (this.controller === controller) this.setFailure(OPERATION_FAILED_STATE);
    });
  };

  /** Publishes a generic failure for input the screen rejects before reaching the controller. */
  fail = (): void => {
    this.setFailure(OPERATION_FAILED_STATE);
  };

  reset = (): void => {
    this.setFailure(null);
    this.controller?.reset();
  };

  dispose = (): void => {
    const controller = this.controller;
    this.controller = null;
    if (!controller) return;
    try {
      controller.dispose();
    } catch (e) {
      LOGGER.warn("identity.google.cleanup.failed", {
        operation: `${this.screen}_controller_dispose`,
        ...safeErrorLogFields(e),
      });
    }
  };

  private ensureController(): GoogleIdentityControllerPort | null {
    if (this.controller) return this.controller;
    try {
      const controller = this.createController();
      this.controller = controller;
      // The controller clears its listeners in dispose(), so the unsubscribe handle is not kept.
      controller.subscribe(this.notify);
      return controller;
    } catch (e) {
      LOGGER.warn(`identity.google.${this.screen}_ui.failed`, {
        operation: "construct_controller",
        ...safeErrorLogFields(e),
      });
      this.setFailure(OPERATION_FAILED_STATE);
      return null;
    }
  }

  private setFailure(failure: GoogleIdentityViewState | null): void {
    if (this.failure === failure) return;
    this.failure = failure;
    this.notify();
  }

  private notify = (): void => {
    for (const listener of this.listeners) listener();
  };
}

/** Connects a screen to its own Google identity controller through `useSyncExternalStore`. */
export function useGoogleIdentityStore(screen: GoogleIdentityScreen) {
  const { googleClientId, homegateBaseUrl } = useGoogleIdentityConfiguration();
  const { createGoogleIdentityController } = usePassportCollaborators();
  const [store] = useState(
    () =>
      new GoogleIdentityStore(
        () => createGoogleIdentityController(googleClientId, homegateBaseUrl),
        screen,
      ),
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, () => IDLE_STATE);

  useEffect(() => () => store.dispose(), [store]);

  return { fail: store.fail, reset: store.reset, run: store.run, state };
}
