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

type CreateOrRestoreGoogleIdentityCompletion = {
  googleAccount?: GoogleAccountProfile;
  identity: PubkyPublicIdentity;
  mode: "created" | "restored";
};

type CreateOrRestoreGoogleIdentityState =
  | { status: "ready"; ready: boolean; start: () => void }
  | { status: "access-pending" }
  | { status: "access-denied"; back: () => void; tryAgain: () => void }
  | { status: "setup"; progress: GoogleBackedIdentityProgress };

function useCreateOrRestoreGoogleIdentity({ controller, onComplete, onSetupStarted }: {
  controller: PassportIdentityController;
  onComplete: (completion: CreateOrRestoreGoogleIdentityCompletion) => void;
  onSetupStarted: () => void;
}): CreateOrRestoreGoogleIdentityState {
  const dispatching = useRef(false);
  const callbacks = useRef({ onComplete, onSetupStarted });
  const [state, setState] = useState<GoogleBackedIdentityActionState>({ stage: "google-authorization", errorCode: null });
  const [failed, setFailed] = useState(false);
  const [authorizationReady, setAuthorizationReady] = useState(false);

  useEffect(() => { callbacks.current = { onComplete, onSetupStarted }; }, [onComplete, onSetupStarted]);

  const start = useCallback((): void => {
    if (dispatching.current) return;
    dispatching.current = true;
    callbacks.current.onSetupStarted();
    void controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" })
      .then((completed) => {
        if (completed.status !== "action_completed") return;
        if (Result.isError(completed.result) || completed.result.value.kind !== "google_backed_identity_established") {
          setFailed(true);
          return;
        }
        const established = completed.result.value;
        const catalog = controller.list();
        const googleAccount = Result.isOk(catalog)
          ? catalog.value.identities.find((candidate) => candidate.id === established.publicIdentity.publicKeyZ32)?.googleAccount
          : undefined;
        callbacks.current.onComplete({
          identity: established.publicIdentity,
          mode: established.establishmentMode,
          ...(googleAccount ? { googleAccount } : {}),
        });
      })
      .catch(() => setFailed(true))
      .finally(() => { dispatching.current = false; });
  }, [controller]);

  const back = useCallback(() => {
    dispatching.current = false;
    setFailed(false);
    setState({ stage: "google-authorization", errorCode: null });
  }, []);

  const tryAgain = useCallback(() => {
    dispatching.current = false;
    setFailed(false);
    start();
  }, [start]);

  useEffect(() => {
    void controller.prepareGoogleAuthorization((nextState) => {
      setState(nextState);
      if (nextState.stage === "google-authorization" && nextState.errorCode === null) setAuthorizationReady(true);
    }).catch(() => setFailed(true));
    return () => { try { controller.disposeGoogleAuthorization(); } catch { /* Controller owns cleanup logging. */ } };
  }, [controller]);

  if (failed || (state.stage === "google-authorization" && state.errorCode !== null)) {
    return { status: "access-denied", back, tryAgain };
  }
  if (state.stage === "requesting-google-authorization") return { status: "access-pending" };
  if (state.stage === "establishing-google-backed-identity") return { status: "setup", progress: state.progress };
  return { status: "ready", ready: authorizationReady, start };
}

export { useCreateOrRestoreGoogleIdentity };
export type { CreateOrRestoreGoogleIdentityCompletion, CreateOrRestoreGoogleIdentityState };
