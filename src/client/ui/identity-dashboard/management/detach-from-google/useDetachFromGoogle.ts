"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useReducer, useRef } from "react";

import { GoogleIdentityFlow } from "../../../../logic/google-identity/GoogleIdentityFlow";
import type { GoogleIdentityConfiguration } from "../../../../logic/google-identity/GoogleIdentityFlow";
import type { PubkyPublicIdentity } from "../../../../logic/pubky/pubkyIdentityKey";
import { transitionDetachFromGoogleOperation } from "./detachFromGoogleOperationState";

function useDetachFromGoogle(
  configuration: GoogleIdentityConfiguration,
  publicIdentity: PubkyPublicIdentity,
  expectedGoogleAccountId: string,
) {
  const { googleClientId, homegateBaseUrl } = configuration;
  const dispatching = useRef(false);
  const flow = useRef<GoogleIdentityFlow | null>(null);
  const [state, dispatch] = useReducer(transitionDetachFromGoogleOperation, { name: "ready" });

  const detach = useCallback(() => {
    if ((state.name !== "ready"
      && state.name !== "authorization-failed"
      && state.name !== "operation-failed")
      || dispatching.current) return;
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

  useEffect(() => {
    let googleFlow: GoogleIdentityFlow;
    try {
      googleFlow = new GoogleIdentityFlow({ googleClientId, homegateBaseUrl }, (nextState) => {
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
      flow.current = googleFlow;
    } catch {
      dispatch({ type: "operation-failed", error: { code: "operation_failed" } });
      return;
    }
    return () => {
      flow.current = null;
      googleFlow.dispose();
    };
  }, [googleClientId, homegateBaseUrl]);

  return { detach, retryDetachment: detach, state };
}

export { useDetachFromGoogle };
