import { useCallback, useEffect, useRef } from "react";

import { LOGGER, safeErrorLogFields } from "../../libs/logger/logger";
import {
  GoogleIdentityController,
  type GoogleIdentityViewState,
} from "../logic/google-identity/GoogleIdentityController";
import { useGoogleIdentityConfiguration } from "./googleIdentityConfiguration";

type GoogleIdentityOperation<T> = {
  /** Log label for the operation, e.g. `"establish"` or `"detach"`. */
  operation: string;
  /** Starts the controller call. Runs synchronously once the operation is accepted. */
  start: (controller: GoogleIdentityController) => Promise<T>;
  /** Receives the resolved value while this operation is still the current one. */
  onSettled: (value: T) => void;
  /** Runs after a rejected promise has been logged, while this operation is still current. */
  onRejected: () => void;
};

/**
 * Owns one lazily constructed {@link GoogleIdentityController} for the lifetime of a component.
 *
 * Operations are serialised: a new one is refused while another is pending, and results of
 * abandoned or superseded operations are dropped. The controller is disposed on unmount and when
 * the Google identity configuration changes.
 */
function useGoogleIdentityController({
  disposeOperation,
  failureEvent,
  onControllerState,
  onUnavailable,
}: {
  /** `operation` field logged when disposing the controller fails. */
  disposeOperation: string;
  /** Log event for controller construction and operation failures. */
  failureEvent: string;
  /** Receives controller state changes while the controller is current. */
  onControllerState: (state: GoogleIdentityViewState) => void;
  /** Runs when the controller could not be constructed. */
  onUnavailable: () => void;
}) {
  const { googleClientId, homegateBaseUrl } = useGoogleIdentityConfiguration();
  const controllerRef = useRef<GoogleIdentityController | null>(null);
  const operationPendingRef = useRef(false);
  const operationIdRef = useRef(0);
  const callbacksRef = useRef({ onControllerState, onUnavailable });

  useEffect(() => {
    callbacksRef.current = { onControllerState, onUnavailable };
  }, [onControllerState, onUnavailable]);

  const ensureController = useCallback((): GoogleIdentityController | null => {
    if (controllerRef.current) return controllerRef.current;

    try {
      const controller = new GoogleIdentityController(
        googleClientId,
        homegateBaseUrl,
        (nextState) => {
          if (controllerRef.current !== controller) return;
          callbacksRef.current.onControllerState(nextState);
        },
      );
      controllerRef.current = controller;
      return controller;
    } catch (e) {
      LOGGER.warn(failureEvent, {
        operation: "construct_controller",
        ...safeErrorLogFields(e),
      });
      callbacksRef.current.onUnavailable();
      return null;
    }
  }, [failureEvent, googleClientId, homegateBaseUrl]);

  /** Starts an operation unless one is already pending. Returns whether it was accepted. */
  const startOperation = useCallback(
    <T>({ onRejected, onSettled, operation, start }: GoogleIdentityOperation<T>): boolean => {
      if (operationPendingRef.current) return false;
      const controller = ensureController();
      if (!controller) return false;

      operationPendingRef.current = true;
      const operationId = ++operationIdRef.current;
      const isCurrent = () =>
        controllerRef.current === controller && operationIdRef.current === operationId;

      void start(controller)
        .then((value) => {
          if (isCurrent()) onSettled(value);
        })
        .catch((e: unknown) => {
          LOGGER.warn(failureEvent, {
            operation,
            stage: "operation_promise",
            ...safeErrorLogFields(e),
          });
          if (isCurrent()) onRejected();
        })
        .finally(() => {
          if (operationIdRef.current === operationId) operationPendingRef.current = false;
        });
      return true;
    },
    [ensureController, failureEvent],
  );

  /** Drops the pending operation, if any, so its result is ignored and a new one may start. */
  const abandonOperation = useCallback(() => {
    operationIdRef.current += 1;
    operationPendingRef.current = false;
  }, []);

  /** Returns the constructed controller without constructing one. */
  const getController = useCallback(() => controllerRef.current, []);

  useEffect(() => {
    return () => {
      operationIdRef.current += 1;
      operationPendingRef.current = false;
      const controller = controllerRef.current;
      if (!controller) return;
      controllerRef.current = null;
      try {
        controller.dispose();
      } catch (e) {
        LOGGER.warn("identity.google.cleanup.failed", {
          operation: disposeOperation,
          ...safeErrorLogFields(e),
        });
      }
    };
  }, [disposeOperation, ensureController]);

  return { abandonOperation, getController, startOperation };
}

export { useGoogleIdentityController };
