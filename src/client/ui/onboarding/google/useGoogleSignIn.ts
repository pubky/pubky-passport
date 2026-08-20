"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { GoogleIdentityController } from "../../../logic/google-identity/GoogleIdentityController";
import type { GoogleIdentityConfiguration } from "../../../logic/google-identity/GoogleIdentityController";
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
  const googleIdentityControllerRef = useRef<GoogleIdentityController | null>(null);
  const [controllerReady, setControllerReady] = useState(false);
  const [state, dispatch] = useReducer(
    transitionGoogleSignIn,
    INITIAL_GOOGLE_SIGN_IN_STATE,
  );

  const establishIdentity = useCallback((): void => {
    if (operationPendingRef.current) return;

    const googleIdentityController = googleIdentityControllerRef.current;
    if (!googleIdentityController) {
      dispatch({ type: "authorization-denied" });
      return;
    }

    operationPendingRef.current = true;
    dispatch({ type: "request-started" });

    void googleIdentityController.establishIdentity()
      .then((result) => {
        if (googleIdentityControllerRef.current !== googleIdentityController) return;

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
        if (googleIdentityControllerRef.current === googleIdentityController) {
          dispatch({ type: "operation-failed", error: { code: "operation_failed" } });
        }
      })
      .finally(() => {
        if (googleIdentityControllerRef.current === googleIdentityController) {
          operationPendingRef.current = false;
        }
      });
  }, [onEstablished]);

  const back = useCallback(() => {
    operationPendingRef.current = false;
    googleIdentityControllerRef.current?.clearPinnedGoogleAccount();
    dispatch({ type: "back" });
  }, []);

  useEffect(() => {
    let active = true;
    let googleIdentityController: GoogleIdentityController;
    queueMicrotask(() => {
      if (active) setControllerReady(false);
    });
    try {
      googleIdentityController = new GoogleIdentityController({ googleClientId, homegateBaseUrl }, (nextState) => {
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
      googleIdentityControllerRef.current = googleIdentityController;
      queueMicrotask(() => {
        if (active && googleIdentityControllerRef.current === googleIdentityController) {
          setControllerReady(true);
        }
      });
    } catch {
      dispatch({ type: "operation-failed", error: { code: "operation_failed" } });
      return;
    }

    return () => {
      active = false;
      googleIdentityControllerRef.current = null;
      googleIdentityController.dispose();
    };
  }, [googleClientId, homegateBaseUrl]);

  return {
    back,
    establishIdentity,
    controllerReady,
    state,
  };
}

export { useGoogleSignIn, type GoogleIdentityEstablished };
