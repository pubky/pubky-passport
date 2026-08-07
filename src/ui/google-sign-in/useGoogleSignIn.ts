"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  GoogleBackedIdentityAction,
  GoogleBackedIdentityProgress,
  PassportIdentityControllerError,
  PassportIdentityController,
} from "../../browser/identity/passportIdentity";
import type { GoogleAccountProfile } from "../../core/identity/googleAccountProfile";
import type { PubkyPublicIdentity } from "../../core/identity/pubkyIdentity";

type GoogleSignInCompletion = {
  googleAccount?: GoogleAccountProfile;
  identity: PubkyPublicIdentity;
  mode: "created" | "restored";
};

type GoogleSignInState =
  | { status: "idle"; ready: boolean; start: () => void }
  | { status: "requesting-access" }
  | { status: "denied"; back: () => void; tryAgain: () => void }
  | {
      status: "failed";
      back: () => void;
      error: PassportIdentityControllerError;
      replace: (() => void) | null;
      tryAgain: () => void;
    }
  | { status: "working"; progress: GoogleBackedIdentityProgress }
  | ({ status: "complete" } & GoogleSignInCompletion);

type GoogleSignInView =
  | { status: "idle"; ready: boolean }
  | { status: "requesting-access" }
  | { status: "denied" }
  | { status: "failed"; error: PassportIdentityControllerError }
  | { status: "working"; progress: GoogleBackedIdentityProgress }
  | ({ status: "complete" } & GoogleSignInCompletion);

function useGoogleSignIn({ controller, onSetupStarted }: {
  controller: PassportIdentityController;
  onSetupStarted: () => void;
}): GoogleSignInState {
  const dispatching = useRef(false);
  const authorizationReady = useRef(false);
  const setupStarted = useRef(onSetupStarted);
  const [view, setView] = useState<GoogleSignInView>({ status: "idle", ready: false });

  useEffect(() => { setupStarted.current = onSetupStarted; }, [onSetupStarted]);

  const run = useCallback((action: GoogleBackedIdentityAction): void => {
    if (dispatching.current) return;
    dispatching.current = true;
    setView({ status: "requesting-access" });
    setupStarted.current();
    void controller.continueGoogleBackedIdentityAction(action)
      .then((completed) => {
        if (completed.status !== "action_completed") {
          if (completed.status === "google_authorization_failed") setView({ status: "denied" });
          return;
        }
        if (Result.isError(completed.result)) {
          setView({ status: "failed", error: completed.result.error });
          return;
        }
        if (completed.result.value.kind !== "google_backed_identity_established") {
          setView({ status: "failed", error: { code: "unexpected_failure" } });
          return;
        }
        const established = completed.result.value;
        const catalog = controller.list();
        const googleAccount = Result.isOk(catalog)
          ? catalog.value.identities.find((candidate) => candidate.id === established.publicIdentity.publicKeyZ32)?.googleAccount
          : undefined;
        setView({
          status: "complete",
          identity: established.publicIdentity,
          mode: established.establishmentMode,
          ...(googleAccount ? { googleAccount } : {}),
        });
      })
      .catch(() => setView({ status: "failed", error: { code: "unexpected_failure" } }))
      .finally(() => { dispatching.current = false; });
  }, [controller]);

  const start = useCallback(() => {
    run({ kind: "establish_google_backed_identity" });
  }, [run]);

  const back = useCallback(() => {
    dispatching.current = false;
    setView({ status: "idle", ready: authorizationReady.current });
  }, []);

  const tryAgain = useCallback(() => {
    dispatching.current = false;
    start();
  }, [start]);

  const replace = useCallback((error: PassportIdentityControllerError) => {
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
        if (nextState.errorCode !== null) setView({ status: "denied" });
        else {
          authorizationReady.current = true;
          if (!dispatching.current) setView({ status: "idle", ready: true });
        }
      } else if (nextState.stage === "requesting-google-authorization") {
        setView({ status: "requesting-access" });
      } else if (nextState.stage === "establishing-google-backed-identity") {
        setView({ status: "working", progress: nextState.progress });
      }
    }).catch(() => setView({ status: "denied" }));
    return () => { try { controller.disposeGoogleAuthorization(); } catch { /* Controller owns cleanup logging. */ } };
  }, [controller]);

  if (view.status === "denied") return { ...view, back, tryAgain };
  if (view.status === "failed") {
    return {
      ...view,
      back,
      replace: view.error.recovery ? () => replace(view.error) : null,
      tryAgain,
    };
  }
  if (view.status === "idle") return { ...view, start };
  return view;
}

export { useGoogleSignIn };
