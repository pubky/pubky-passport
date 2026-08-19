"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { GoogleIdentityFlow } from "../../../logic/google-identity/GoogleIdentityFlow";
import type { GoogleIdentityConfiguration } from "../../../logic/google-identity/GoogleIdentityFlow";
import type { GoogleAccountProfile } from "../../../logic/local-identity/localIdentityModels";
import type { PubkyPublicIdentity } from "../../../logic/pubky/pubkyIdentityKey";
import {
  INITIAL_GOOGLE_SIGN_IN_STATE,
  transitionGoogleSignIn,
} from "./googleSignInState";

type GoogleIdentityEstablished = {
  googleAccount: GoogleAccountProfile;
  identity: PubkyPublicIdentity;
  mode: "created" | "restored";
};

function useGoogleSignIn(
  configuration: GoogleIdentityConfiguration,
  onEstablished?: (identity: GoogleIdentityEstablished) => void,
) {
  const { googleClientId, homegateBaseUrl } = configuration;
  const operationPendingRef = useRef(false);
  const flowRef = useRef<GoogleIdentityFlow | null>(null);
  const [flowReady, setFlowReady] = useState(false);
  const [state, dispatch] = useReducer(
    transitionGoogleSignIn,
    INITIAL_GOOGLE_SIGN_IN_STATE,
  );

  const establishIdentity = useCallback((): void => {
    if (operationPendingRef.current) return;

    const currentFlow = flowRef.current;
    if (!currentFlow) {
      dispatch({ type: "authorization-denied" });
      return;
    }

    operationPendingRef.current = true;
    dispatch({ type: "request-started" });

    void currentFlow.establishIdentity()
      .then((result) => {
        if (flowRef.current !== currentFlow) return;

        if (Result.isError(result)) {
          if (result.error.code === "cancelled") return;

          dispatch(
            result.error.code === "authorization_failed"
              ? { type: "authorization-denied" }
              : { type: "operation-failed", error: result.error },
          );
          return;
        }

        const established: GoogleIdentityEstablished = {
          googleAccount: result.value.googleAccount,
          identity: result.value.publicIdentity,
          mode: result.value.establishmentMode,
        };

        onEstablished?.(established);
        dispatch({
          type: "operation-completed",
          googleAccount: established.googleAccount,
          identity: established.identity,
          mode: established.mode,
        });
      })
      .catch(() => {
        if (flowRef.current === currentFlow) {
          dispatch({ type: "operation-failed", error: { code: "operation_failed" } });
        }
      })
      .finally(() => {
        if (flowRef.current === currentFlow) {
          operationPendingRef.current = false;
        }
      });
  }, [onEstablished]);

  const back = useCallback(() => {
    operationPendingRef.current = false;
    dispatch({ type: "back" });
  }, []);

  useEffect(() => {
    let active = true;
    let googleFlow: GoogleIdentityFlow;
    queueMicrotask(() => {
      if (active) setFlowReady(false);
    });
    try {
      googleFlow = new GoogleIdentityFlow({ googleClientId, homegateBaseUrl }, (nextState) => {
        switch (nextState.status) {
          case "requesting-authorization":
            dispatch({ type: "request-started" });
            return;
          case "establishing":
            dispatch({ type: "progress-reported", progress: nextState.progress });
            return;
          case "detaching":
            return;
        }
      });
      flowRef.current = googleFlow;
      queueMicrotask(() => {
        if (active && flowRef.current === googleFlow) setFlowReady(true);
      });
    } catch {
      dispatch({ type: "operation-failed", error: { code: "operation_failed" } });
      return;
    }

    return () => {
      active = false;
      flowRef.current = null;
      googleFlow.dispose();
    };
  }, [googleClientId, homegateBaseUrl]);

  return {
    back,
    establishIdentity,
    flowReady,
    state,
  };
}

export { useGoogleSignIn, type GoogleIdentityEstablished };
