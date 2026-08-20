"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useReducer, useRef } from "react";

import {
  GoogleIdentityController,
  type GoogleIdentityConfiguration,
  type GoogleIdentityError,
} from "../../../../logic/google-identity/GoogleIdentityController";
import type { PubkyPublicIdentity } from "../../../../logic/pubky/pubkyIdentityKey";

type DetachFromGoogleOperationState =
  | { name: "ready" }
  | { name: "requesting-authorization" }
  | { name: "deleting-backup" }
  | { name: "authorization-failed" }
  | { name: "operation-failed"; error: GoogleIdentityError }
  | { name: "complete" };

type DetachFromGoogleOperationEvent =
  | { type: "authorization-failed" }
  | { type: "request-started" }
  | { type: "deletion-started" }
  | { type: "operation-failed"; error: GoogleIdentityError }
  | { type: "operation-completed" };

function transitionDetachFromGoogleOperation(
  _state: DetachFromGoogleOperationState,
  event: DetachFromGoogleOperationEvent,
): DetachFromGoogleOperationState {
  switch (event.type) {
    case "authorization-failed":
      return { name: "authorization-failed" };
    case "request-started":
      return { name: "requesting-authorization" };
    case "deletion-started":
      return { name: "deleting-backup" };
    case "operation-failed":
      return { name: "operation-failed", error: event.error };
    case "operation-completed":
      return { name: "complete" };
  }
}

function useDetachFromGoogle(
  configuration: GoogleIdentityConfiguration,
  publicIdentity: PubkyPublicIdentity,
  expectedGoogleAccountId: string,
) {
  const { googleClientId, homegateBaseUrl } = configuration;
  const dispatching = useRef(false);
  const controller = useRef<GoogleIdentityController | null>(null);
  const [state, dispatch] = useReducer(transitionDetachFromGoogleOperation, { name: "ready" });

  const detach = useCallback(() => {
    if ((state.name !== "ready"
      && state.name !== "authorization-failed"
      && state.name !== "operation-failed")
      || dispatching.current) return;
    const currentController = controller.current;
    if (!currentController) {
      dispatch({ type: "operation-failed", error: { code: "operation_failed" } });
      return;
    }
    dispatching.current = true;
    dispatch({ type: "request-started" });
    void currentController.detachIdentity(publicIdentity, expectedGoogleAccountId)
      .then((completed) => {
        if (controller.current !== currentController) return;
        if (Result.isError(completed)) {
          if (completed.error.code === "cancelled") return;
          if (completed.error.code === "authorization_failed") {
            dispatch({ type: "authorization-failed" });
          } else {
            dispatch({ type: "operation-failed", error: completed.error });
          }
          return;
        }
        dispatch({ type: "operation-completed" });
      })
      .catch(() => {
        if (controller.current === currentController) {
          dispatch({ type: "operation-failed", error: { code: "operation_failed" } });
        }
      })
      .finally(() => {
        if (controller.current === currentController) dispatching.current = false;
      });
  }, [expectedGoogleAccountId, publicIdentity, state.name]);

  useEffect(() => {
    let googleController: GoogleIdentityController;
    try {
      googleController = new GoogleIdentityController({ googleClientId, homegateBaseUrl }, (nextState) => {
        switch (nextState.status) {
          case "requesting-authorization":
            dispatch({ type: "request-started" });
            return;
          case "detaching":
            dispatch({ type: "deletion-started" });
            return;
          case "establishing":
            return;
        }
      });
      controller.current = googleController;
    } catch {
      dispatch({ type: "operation-failed", error: { code: "operation_failed" } });
      return;
    }
    return () => {
      controller.current = null;
      googleController.dispose();
    };
  }, [googleClientId, homegateBaseUrl]);

  return { detach, retryDetachment: detach, state };
}

export { useDetachFromGoogle };
