"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  GoogleBackedIdentityActionState,
  GoogleBackedIdentityProgress,
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
  | { status: "working"; progress: GoogleBackedIdentityProgress }
  | ({ status: "complete" } & GoogleSignInCompletion);

type GoogleSignInView =
  | { status: "idle"; ready: boolean }
  | { status: "requesting-access" }
  | { status: "denied" }
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

  const start = useCallback((): void => {
    if (dispatching.current) return;
    dispatching.current = true;
    setView({ status: "requesting-access" });
    setupStarted.current();
    void controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" })
      .then((completed) => {
        if (completed.status !== "action_completed") return;
        if (Result.isError(completed.result) || completed.result.value.kind !== "google_backed_identity_established") {
          setView({ status: "denied" });
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
      .catch(() => setView({ status: "denied" }))
      .finally(() => { dispatching.current = false; });
  }, [controller]);

  const back = useCallback(() => {
    dispatching.current = false;
    setView({ status: "idle", ready: authorizationReady.current });
  }, []);

  const tryAgain = useCallback(() => {
    dispatching.current = false;
    start();
  }, [start]);

  useEffect(() => {
    void controller.prepareGoogleAuthorization((nextState) => {
      if (nextState.stage === "google-authorization" && nextState.errorCode === null) {
        authorizationReady.current = true;
      }
      setViewFromController(nextState, dispatching.current, setView);
    }).catch(() => setView({ status: "denied" }));
    return () => { try { controller.disposeGoogleAuthorization(); } catch { /* Controller owns cleanup logging. */ } };
  }, [controller]);

  if (view.status === "denied") return { ...view, back, tryAgain };
  if (view.status === "idle") return { ...view, start };
  return view;
}

function setViewFromController(
  state: GoogleBackedIdentityActionState,
  dispatching: boolean,
  setView: (view: GoogleSignInView) => void,
): void {
  if (state.stage === "google-authorization") {
    if (state.errorCode !== null) setView({ status: "denied" });
    else if (!dispatching) setView({ status: "idle", ready: true });
    return;
  }
  if (state.stage === "requesting-google-authorization") {
    setView({ status: "requesting-access" });
    return;
  }
  if (state.stage === "establishing-google-backed-identity") {
    setView({ status: "working", progress: state.progress });
  }
}

export { useGoogleSignIn };
export type { GoogleSignInCompletion, GoogleSignInState };
