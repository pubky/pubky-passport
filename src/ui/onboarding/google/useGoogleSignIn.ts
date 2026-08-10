"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useReducer, useRef } from "react";

import type {
  GoogleBackedIdentityAction,
  GoogleBackedIdentityActionResult,
  PassportIdentityController,
  PassportIdentityControllerError,
} from "../../../browser/identity/passportIdentity";
import type { GoogleAccountProfile } from "../../../core/identity/googleAccountProfile";
import type { PubkyPublicIdentity } from "../../../core/identity/pubkyIdentity";
import {
  INITIAL_GOOGLE_SIGN_IN_STATE,
  transitionGoogleSignIn,
} from "./googleSignInState";

type GoogleIdentityEstablished = {
  googleAccount?: GoogleAccountProfile;
  identity: PubkyPublicIdentity;
  mode: "created" | "restored";
};

function useGoogleSignIn(
  controller: PassportIdentityController,
  onEstablished?: (identity: GoogleIdentityEstablished) => void,
) {
  const dispatching = useRef(false);
  const [state, dispatch] = useReducer(transitionGoogleSignIn, INITIAL_GOOGLE_SIGN_IN_STATE);

  const run = useCallback((action: GoogleBackedIdentityAction): void => {
    if (dispatching.current) return;
    dispatching.current = true;
    dispatch({ type: "request-started" });
    void controller.continueGoogleBackedIdentityAction(action)
      .then((completed) => {
        switch (completed.status) {
          case "google_authorization_failed":
            dispatch({ type: "authorization-denied" });
            return;
          case "busy":
          case "superseded":
          case "action_finished_after_unmount":
            return;
          case "action_completed": {
            if (Result.isError(completed.result)) {
              dispatch({ type: "operation-failed", error: completed.result.error });
              return;
            }
            if (completed.result.value.kind !== "google_backed_identity_established") {
              dispatch({ type: "operation-failed", error: { code: "unexpected_failure" } });
              return;
            }
            const established = establishedIdentity(completed.result, controller);
            if (!established) {
              dispatch({ type: "operation-failed", error: { code: "unexpected_failure" } });
              return;
            }
            onEstablished?.(established);
            dispatch({
              type: "operation-completed",
              identity: established.identity,
              mode: established.mode,
              ...(established.googleAccount ? { googleAccount: established.googleAccount } : {}),
            });
            return;
          }
        }
      })
      .catch(() => dispatch({ type: "operation-failed", error: { code: "unexpected_failure" } }))
      .finally(() => { dispatching.current = false; });
  }, [controller, onEstablished]);

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
      switch (nextState.stage) {
        case "google-authorization":
          dispatch({ type: nextState.errorCode === null ? "authorization-ready" : "authorization-denied" });
          return;
        case "requesting-google-authorization":
          dispatch({ type: "request-started" });
          return;
        case "establishing-google-backed-identity":
          dispatch({ type: "progress-reported", progress: nextState.progress });
          return;
        case "detaching-google-backed-identity":
          return;
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

function establishedIdentity(
  result: GoogleBackedIdentityActionResult,
  controller: PassportIdentityController,
): GoogleIdentityEstablished | null {
  if (Result.isError(result) || result.value.kind !== "google_backed_identity_established") return null;
  const established = result.value;
  const catalog = controller.list();
  const googleAccount = Result.isOk(catalog)
    ? catalog.value.identities.find((candidate) => candidate.id === established.publicIdentity.publicKeyZ32)?.googleAccount
    : undefined;
  return {
    identity: established.publicIdentity,
    mode: established.establishmentMode,
    ...(googleAccount ? { googleAccount } : {}),
  };
}

export { useGoogleSignIn, type GoogleIdentityEstablished };
