"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useReducer, useRef } from "react";

import type {
  GoogleAccountProfile,
  GoogleBackedIdentityFlow,
  PassportIdentityController,
  PubkyPublicIdentity,
} from "../../../logic/identity/PassportIdentityController";
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
  controller: PassportIdentityController,
  onEstablished?: (identity: GoogleIdentityEstablished) => void,
) {
  const operationPendingRef = useRef(false);
  const flowRef = useRef<GoogleBackedIdentityFlow | null>(null);
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
    const googleFlow = controller.startGoogleIdentityFlow((nextState) => {
      switch (nextState.status) {
        case "ready":
          dispatch({ type: "authorization-ready" });
          return;
        case "authorization-failed":
          dispatch({ type: "authorization-denied" });
          return;
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

    return () => {
      flowRef.current = null;
      googleFlow.dispose();
    };
  }, [controller]);

  return {
    back,
    start: establishIdentity,
    state,
  };
}

export { useGoogleSignIn, type GoogleIdentityEstablished };
