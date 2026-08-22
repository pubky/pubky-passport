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
  | { status: "ready" }
  | { status: "requesting-authorization" }
  | { status: "detaching" }
  | { status: "authorization-failed" }
  | { status: "operation-failed"; error: GoogleIdentityError }
  | { status: "complete" };

type DetachFromGoogleOperationEvent =
  | { type: "authorization-failed" }
  | { type: "request-started" }
  | { type: "detachment-started" }
  | { type: "operation-failed"; error: GoogleIdentityError }
  | { type: "operation-completed" };

function transitionDetachFromGoogleOperation(
  _state: DetachFromGoogleOperationState,
  event: DetachFromGoogleOperationEvent,
): DetachFromGoogleOperationState {
  switch (event.type) {
    case "authorization-failed":
      return { status: "authorization-failed" };
    case "request-started":
      return { status: "requesting-authorization" };
    case "detachment-started":
      return { status: "detaching" };
    case "operation-failed":
      return { status: "operation-failed", error: event.error };
    case "operation-completed":
      return { status: "complete" };
  }
}

function useDetachFromGoogle(
  configuration: GoogleIdentityConfiguration,
  publicIdentity: PubkyPublicIdentity,
  expectedGoogleSubject: string,
) {
  const { googleClientId, homegateBaseUrl } = configuration;
  const operationPendingRef = useRef(false);
  const googleIdentityControllerRef = useRef<GoogleIdentityController | null>(null);
  const [state, dispatch] = useReducer(transitionDetachFromGoogleOperation, { status: "ready" });

  const detach = useCallback(() => {
    if ((state.status !== "ready"
      && state.status !== "authorization-failed"
      && state.status !== "operation-failed")
      || operationPendingRef.current) return;
    const googleIdentityController = googleIdentityControllerRef.current;
    if (!googleIdentityController) {
      dispatch({ type: "operation-failed", error: { code: "operation_failed" } });
      return;
    }
    operationPendingRef.current = true;
    dispatch({ type: "request-started" });
    void googleIdentityController.detachIdentity(publicIdentity, expectedGoogleSubject)
      .then((completed) => {
        if (googleIdentityControllerRef.current !== googleIdentityController) return;
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
        if (googleIdentityControllerRef.current === googleIdentityController) {
          dispatch({ type: "operation-failed", error: { code: "operation_failed" } });
        }
      })
      .finally(() => {
        if (googleIdentityControllerRef.current === googleIdentityController) {
          operationPendingRef.current = false;
        }
      });
  }, [expectedGoogleSubject, publicIdentity, state.status]);

  useEffect(() => {
    let googleIdentityController: GoogleIdentityController;
    try {
      googleIdentityController = new GoogleIdentityController({ googleClientId, homegateBaseUrl }, (nextState) => {
        switch (nextState.status) {
          case "requesting-authorization":
            dispatch({ type: "request-started" });
            return;
          case "detaching":
            dispatch({ type: "detachment-started" });
            return;
          case "establishing":
            return;
        }
      });
      googleIdentityControllerRef.current = googleIdentityController;
    } catch {
      dispatch({ type: "operation-failed", error: { code: "operation_failed" } });
      return;
    }
    return () => {
      googleIdentityControllerRef.current = null;
      googleIdentityController.dispose();
    };
  }, [googleClientId, homegateBaseUrl]);

  return { detach, retryDetachment: detach, state };
}

export { useDetachFromGoogle };
