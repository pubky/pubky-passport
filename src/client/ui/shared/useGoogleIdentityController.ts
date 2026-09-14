import type { Result } from "better-result";
import { useEffect, useState, useSyncExternalStore } from "react";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type {
  GoogleIdentityViewError,
  GoogleIdentityViewState,
} from "@/client/logic/google-identity/GoogleIdentityController";
import { useGoogleIdentityConfiguration } from "@/client/ui/googleIdentityConfiguration";
import {
  usePassportCollaborators,
  type PassportCollaborators,
} from "@/client/ui/passportCollaborators";

type GoogleIdentityController = ReturnType<PassportCollaborators["createGoogleIdentityController"]>;
type GoogleIdentityOperation = (
  controller: GoogleIdentityController,
) => Promise<Result<unknown, GoogleIdentityViewError>>;

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
 * this store only adds a generic `operation_failed` state for construction failures
 * and rejected operation promises, which the real controller never produces.
 */
class GoogleIdentityStore {
  private controller: GoogleIdentityController | null = null;
  private failure: GoogleIdentityViewState | null = null;
  private unsubscribeController: (() => void) | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly createController: () => GoogleIdentityController,
    private readonly logEvent: string,
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
  run = (name: string, operation: GoogleIdentityOperation): void => {
    const controller = this.ensureController();
    if (!controller) return;
    this.setFailure(null);
    operation(controller).catch((e: unknown) => {
      LOGGER.warn(this.logEvent, {
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
    this.unsubscribeController?.();
    this.unsubscribeController = undefined;
    if (!controller) return;
    try {
      controller.dispose();
    } catch (e) {
      LOGGER.warn("identity.google.cleanup.failed", {
        operation: "controller_dispose",
        ...safeErrorLogFields(e),
      });
    }
  };

  private ensureController(): GoogleIdentityController | null {
    if (this.controller) return this.controller;
    try {
      const controller = this.createController();
      this.controller = controller;
      this.unsubscribeController = controller.subscribe(this.notify);
      return controller;
    } catch (e) {
      LOGGER.warn(this.logEvent, {
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

/**
 * Connects a screen to its own Google identity controller through `useSyncExternalStore`.
 *
 * @param logEvent Stable warn event for failures that originate in this bridge rather
 * than in the controller.
 */
export function useGoogleIdentityController(logEvent: string) {
  const { googleClientId, homegateBaseUrl } = useGoogleIdentityConfiguration();
  const { createGoogleIdentityController } = usePassportCollaborators();
  const [store] = useState(
    () =>
      new GoogleIdentityStore(
        () => createGoogleIdentityController(googleClientId, homegateBaseUrl),
        logEvent,
      ),
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, () => IDLE_STATE);

  useEffect(() => store.dispose, [store]);

  return { fail: store.fail, reset: store.reset, run: store.run, state };
}
