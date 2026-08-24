"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { LOGGER } from "../../../../libs/logger/logger";
import { GoogleIdentityController } from "../../../logic/google-identity/GoogleIdentityController";
import { useGoogleIdentityConfiguration } from "../../googleIdentityConfiguration";
import { toGoogleIdentityViewError } from "../../../logic/google-identity/googleIdentityViewError";
import {
  INITIAL_GOOGLE_IDENTITY_ESTABLISHMENT_STATE,
  transitionGoogleIdentityEstablishment,
} from "./googleIdentityEstablishmentState";

function useGoogleIdentityEstablishment() {
  const { googleClientId, homegateBaseUrl } = useGoogleIdentityConfiguration();
  const operationPendingRef = useRef(false);
  const googleIdentityControllerRef = useRef<GoogleIdentityController | null>(null);
  const [controllerReady, setControllerReady] = useState(false);
  const [state, dispatch] = useReducer(
    transitionGoogleIdentityEstablishment,
    INITIAL_GOOGLE_IDENTITY_ESTABLISHMENT_STATE,
  );

  const startIdentityOperation = useCallback((operation: "establish" | "replace-invalid-file"): void => {
    if (operationPendingRef.current) return;

    const googleIdentityController = googleIdentityControllerRef.current;
    if (!googleIdentityController) {
      dispatch({ type: "operation-failed", error: { code: "operation_failed" } });
      return;
    }

    operationPendingRef.current = true;
    dispatch({ type: "request-started" });

    const pending = operation === "establish"
      ? googleIdentityController.establishIdentity()
      : googleIdentityController.replaceInvalidPassportFile();
    void pending
      .then((result) => {
        if (googleIdentityControllerRef.current !== googleIdentityController) return;

        if (Result.isError(result)) {
          if (result.error.code === "cancelled") return;

          dispatch({
            type: "operation-failed",
            error: toGoogleIdentityViewError(result.error),
          });
          return;
        }

        dispatch({
          type: "operation-completed",
          googleAccount: result.value.googleAccount,
          identity: result.value.publicIdentity,
          mode: result.value.establishmentMode,
        });
      })
      .catch(() => {
        LOGGER.warn("identity.google.establishment_ui.failed", {
          operation,
          stage: "operation_promise",
        });
        if (googleIdentityControllerRef.current === googleIdentityController) {
          dispatch({ type: "operation-failed", error: { code: "operation_failed" } });
        }
      })
      .finally(() => {
        if (googleIdentityControllerRef.current === googleIdentityController) {
          operationPendingRef.current = false;
        }
      });
  }, []);

  const establishIdentity = useCallback((): void => {
    startIdentityOperation("establish");
  }, [startIdentityOperation]);

  const replaceInvalidPassportFile = useCallback((): void => {
    startIdentityOperation("replace-invalid-file");
  }, [startIdentityOperation]);

  const back = useCallback(() => {
    operationPendingRef.current = false;
    googleIdentityControllerRef.current?.clearPinnedGoogleSubject();
    dispatch({ type: "back" });
  }, []);

  useEffect(() => {
    let active = true;
    let googleIdentityController: GoogleIdentityController;
    queueMicrotask(() => {
      if (active) setControllerReady(false);
    });
    try {
      googleIdentityController = new GoogleIdentityController(googleClientId, homegateBaseUrl, (nextState) => {
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
      try {
        googleIdentityController.dispose();
      } catch {
        LOGGER.warn("identity.google.cleanup.failed", {
          operation: "establishment_controller_dispose",
        });
      }
    };
  }, [googleClientId, homegateBaseUrl]);

  return {
    back,
    establishIdentity,
    replaceInvalidPassportFile,
    controllerReady,
    state,
  };
}

export { useGoogleIdentityEstablishment };
