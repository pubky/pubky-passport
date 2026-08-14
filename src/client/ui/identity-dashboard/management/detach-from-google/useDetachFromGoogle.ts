"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useReducer, useRef } from "react";

import type {
  GoogleBackedIdentityFlow,
  PassportIdentityController,
  PubkyPublicIdentity,
} from "../../../../logic/identity/passportIdentityController";
import { transitionDetachFromGoogleOperation } from "./detachFromGoogleOperationState";

function useDetachFromGoogle(
  controller: PassportIdentityController,
  publicIdentity: PubkyPublicIdentity,
  expectedGoogleAccountId: string,
) {
  const dispatching = useRef(false);
  const flow = useRef<GoogleBackedIdentityFlow | null>(null);
  const [state, dispatch] = useReducer(transitionDetachFromGoogleOperation, { name: "preparing" });

  const detach = useCallback(() => {
    if ((state.name !== "ready" && state.name !== "operation-failed") || dispatching.current) return;
    const currentFlow = flow.current;
    if (!currentFlow) {
      dispatch({ type: "operation-failed", error: { code: "operation_failed" } });
      return;
    }
    dispatching.current = true;
    dispatch({ type: "request-started" });
    void currentFlow.detachIdentity(publicIdentity, expectedGoogleAccountId)
      .then((completed) => {
        if (flow.current !== currentFlow) return;
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
        if (flow.current === currentFlow) {
          dispatch({ type: "operation-failed", error: { code: "operation_failed" } });
        }
      })
      .finally(() => {
        if (flow.current === currentFlow) dispatching.current = false;
      });
  }, [expectedGoogleAccountId, publicIdentity, state.name]);

  const retryAuthorization = useCallback(() => {
    dispatch({ type: "retry-requested" });
    flow.current?.start();
  }, []);

  useEffect(() => {
    const googleFlow = controller.startGoogleIdentityFlow((nextState) => {
      switch (nextState.status) {
        case "ready":
          dispatch({ type: "authorization-ready" });
          return;
        case "authorization-failed":
          dispatch({ type: "authorization-failed" });
          return;
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
    flow.current = googleFlow;
    return () => {
      flow.current = null;
      googleFlow.dispose();
    };
  }, [controller]);

  return { detach, retryAuthorization, state };
}

export { useDetachFromGoogle };
