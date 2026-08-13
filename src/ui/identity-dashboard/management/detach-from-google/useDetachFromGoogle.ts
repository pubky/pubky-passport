"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useReducer, useRef } from "react";

import type { PassportIdentityController } from "../../../../browser/identity/passportIdentityController";
import type { PubkyPublicIdentity } from "../../../../core/identity/pubkyIdentity";
import { transitionDetachFromGoogleOperation } from "./detachFromGoogleOperationState";

function useDetachFromGoogle(
  controller: PassportIdentityController,
  publicIdentity: PubkyPublicIdentity,
  expectedGoogleAccountId: string,
) {
  const dispatching = useRef(false);
  const [state, dispatch] = useReducer(transitionDetachFromGoogleOperation, { name: "preparing" });

  const detach = useCallback(() => {
    if ((state.name !== "ready" && state.name !== "operation-failed") || dispatching.current) return;
    dispatching.current = true;
    dispatch({ type: "request-started" });
    void controller.continueGoogleBackedIdentityAction({
      kind: "detach_google_backed_identity",
      publicIdentity,
      expectedGoogleAccountId,
    })
      .then((completed) => {
        switch (completed.status) {
          case "google_authorization_failed":
            dispatch({ type: "authorization-failed" });
            return;
          case "busy":
          case "superseded":
          case "action_finished_after_unmount":
            dispatch({ type: "operation-failed" });
            return;
          case "action_completed":
            if (Result.isError(completed.result)
              || completed.result.value.kind !== "google_backed_identity_detached") {
              dispatch({ type: "operation-failed" });
              return;
            }
            dispatch({ type: "operation-completed" });
            return;
        }
      })
      .catch(() => dispatch({ type: "operation-failed" }))
      .finally(() => { dispatching.current = false; });
  }, [controller, expectedGoogleAccountId, publicIdentity, state.name]);

  const retryAuthorization = useCallback(() => {
    dispatch({ type: "retry-requested" });
    controller.retryGoogleAuthorization();
  }, [controller]);

  useEffect(() => {
    void controller.prepareGoogleAuthorization((nextState) => {
      switch (nextState.stage) {
        case "google-authorization":
          dispatch({ type: nextState.errorCode === null ? "authorization-ready" : "authorization-failed" });
          return;
        case "requesting-google-authorization":
          dispatch({ type: "request-started" });
          return;
        case "detaching-google-backed-identity":
          dispatch({ type: "deletion-started" });
          return;
        case "establishing-google-backed-identity":
          return;
      }
    }).catch(() => dispatch({ type: "authorization-failed" }));
    return () => { try { controller.disposeGoogleAuthorization(); } catch { /* Controller owns cleanup logging. */ } };
  }, [controller]);

  return { detach, retryAuthorization, state };
}

export { useDetachFromGoogle };
