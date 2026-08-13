"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useReducer, useRef } from "react";

import type {
  GoogleIdentityFlow,
  GoogleIdentityFlowError,
  PassportIdentityController,
} from "../../../browser/identity/passportIdentityController";
import type { GoogleAccountProfile } from "../../../core/identity/googleAccountProfile";
import type { PubkyPublicIdentity } from "../../../core/identity/pubkyIdentity";
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
  const dispatching = useRef(false);
  const flow = useRef<GoogleIdentityFlow | null>(null);
  const [state, dispatch] = useReducer(transitionGoogleSignIn, INITIAL_GOOGLE_SIGN_IN_STATE);

  const run = useCallback((recovery?: NonNullable<GoogleIdentityFlowError["recovery"]>): void => {
    if (dispatching.current) return;
    const currentFlow = flow.current;
    if (!currentFlow) {
      dispatch({ type: "authorization-denied" });
      return;
    }
    dispatching.current = true;
    dispatch({ type: "request-started" });
    const operation = recovery
      ? currentFlow.replaceIncompleteIdentity(recovery.publicIdentity, recovery.googleAccount.id)
      : currentFlow.establishIdentity();
    void operation
      .then((completed) => {
        if (flow.current !== currentFlow) return;
        if (Result.isError(completed)) {
          if (completed.error.code === "cancelled") return;
          dispatch(completed.error.code === "authorization_failed"
            ? { type: "authorization-denied" }
            : { type: "operation-failed", error: completed.error });
          return;
        }
        const established: GoogleIdentityEstablished = {
          googleAccount: completed.value.googleAccount,
          identity: completed.value.publicIdentity,
          mode: completed.value.establishmentMode,
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
        if (flow.current === currentFlow) {
          dispatch({ type: "operation-failed", error: { code: "operation_failed" } });
        }
      })
      .finally(() => {
        if (flow.current === currentFlow) dispatching.current = false;
      });
  }, [onEstablished]);

  const start = useCallback(() => run(), [run]);

  const back = useCallback(() => {
    dispatching.current = false;
    dispatch({ type: "back" });
  }, []);

  const replaceIncompleteBackup = useCallback((error: GoogleIdentityFlowError) => {
    if (!error.recovery) return;
    dispatching.current = false;
    run(error.recovery);
  }, [run]);

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
    flow.current = googleFlow;
    return () => {
      flow.current = null;
      googleFlow.dispose();
    };
  }, [controller]);

  return {
    back,
    replaceIncompleteBackup,
    retry: start,
    start,
    state,
  };
}

export { useGoogleSignIn, type GoogleIdentityEstablished };
