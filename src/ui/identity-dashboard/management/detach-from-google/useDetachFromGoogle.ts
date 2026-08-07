"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useReducer, useRef } from "react";

import type { PassportIdentityController } from "../../../../browser/identity/passportIdentity";
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
        if (completed.status === "google_authorization_failed") {
          dispatch({ type: "authorization-failed" });
          return;
        }
        if (completed.status !== "action_completed"
          || Result.isError(completed.result)
          || completed.result.value.kind !== "google_backed_identity_detached") {
          dispatch({ type: "operation-failed" });
          return;
        }
        dispatch({ type: "operation-completed" });
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
      if (nextState.stage === "google-authorization") {
        dispatch({ type: nextState.errorCode === null ? "authorization-ready" : "authorization-failed" });
      } else if (nextState.stage === "requesting-google-authorization") {
        dispatch({ type: "request-started" });
      } else if (nextState.stage === "detaching-google-backed-identity") {
        dispatch({ type: "deletion-started" });
      }
    }).catch(() => dispatch({ type: "authorization-failed" }));
    return () => { try { controller.disposeGoogleAuthorization(); } catch { /* Controller owns cleanup logging. */ } };
  }, [controller]);

  return { detach, retryAuthorization, state };
}

export { useDetachFromGoogle };
