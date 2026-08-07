"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useReducer, useRef } from "react";

import type {
  GoogleBackedIdentityAction,
  PassportIdentityController,
  PassportIdentityControllerError,
} from "../../../browser/identity/passportIdentity";
import {
  INITIAL_GOOGLE_SIGN_IN_STATE,
  transitionGoogleSignIn,
} from "./googleSignInState";

function useGoogleSignIn(controller: PassportIdentityController) {
  const dispatching = useRef(false);
  const [state, dispatch] = useReducer(transitionGoogleSignIn, INITIAL_GOOGLE_SIGN_IN_STATE);

  const run = useCallback((action: GoogleBackedIdentityAction): void => {
    if (dispatching.current) return;
    dispatching.current = true;
    dispatch({ type: "request-started" });
    void controller.continueGoogleBackedIdentityAction(action)
      .then((completed) => {
        if (completed.status === "google_authorization_failed") {
          dispatch({ type: "authorization-denied" });
          return;
        }
        if (completed.status === "busy"
          || completed.status === "superseded"
          || completed.status === "action_finished_after_unmount") return;
        if (Result.isError(completed.result)) {
          dispatch({ type: "operation-failed", error: completed.result.error });
          return;
        }
        if (completed.result.value.kind !== "google_backed_identity_established") {
          dispatch({ type: "operation-failed", error: { code: "unexpected_failure" } });
          return;
        }
        const established = completed.result.value;
        const catalog = controller.list();
        const googleAccount = Result.isOk(catalog)
          ? catalog.value.identities.find((candidate) => candidate.id === established.publicIdentity.publicKeyZ32)?.googleAccount
          : undefined;
        dispatch({
          type: "operation-completed",
          identity: established.publicIdentity,
          mode: established.establishmentMode,
          ...(googleAccount ? { googleAccount } : {}),
        });
      })
      .catch(() => dispatch({ type: "operation-failed", error: { code: "unexpected_failure" } }))
      .finally(() => { dispatching.current = false; });
  }, [controller]);

  const start = useCallback(() => {
    run({ kind: "establish_google_backed_identity" });
  }, [run]);

  const back = useCallback(() => {
    dispatching.current = false;
    dispatch({ type: "back" });
  }, []);

  const replaceIncompleteBackup = useCallback((error: PassportIdentityControllerError) => {
    if (!error.recovery) return;
    dispatching.current = false;
    run({
      kind: "replace_incomplete_google_backed_identity",
      publicIdentity: error.recovery.publicIdentity,
      expectedGoogleAccountId: error.recovery.googleAccount.id,
    });
  }, [run]);

  useEffect(() => {
    void controller.prepareGoogleAuthorization((nextState) => {
      if (nextState.stage === "google-authorization") {
        dispatch({ type: nextState.errorCode === null ? "authorization-ready" : "authorization-denied" });
      } else if (nextState.stage === "requesting-google-authorization") {
        dispatch({ type: "request-started" });
      } else if (nextState.stage === "establishing-google-backed-identity") {
        dispatch({ type: "progress-reported", progress: nextState.progress });
      }
    }).catch(() => dispatch({ type: "authorization-denied" }));
    return () => { try { controller.disposeGoogleAuthorization(); } catch { /* Controller owns cleanup logging. */ } };
  }, [controller]);

  return {
    back,
    replaceIncompleteBackup,
    retry: start,
    start,
    state,
  };
}

export { useGoogleSignIn };
