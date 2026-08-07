"use client";

import { Result } from "better-result";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PubkyPublicIdentity } from "../../core/identity/pubkyIdentity";
import type { GoogleBackedIdentityActionState, PassportIdentityController } from "../../browser/identity/passportIdentity";

type DetachFromGoogleStatus = "preparing" | "ready" | "pending" | "error" | "complete";

function useDetachFromGoogle(
  controller: PassportIdentityController,
  publicIdentity: PubkyPublicIdentity,
  expectedGoogleAccountId: string,
) {
  const dispatching = useRef(false);
  const [authorizationReady, setAuthorizationReady] = useState(false);
  const [status, setStatus] = useState<DetachFromGoogleStatus>("preparing");

  const detach = useCallback(() => {
    if (!authorizationReady || dispatching.current) return;
    dispatching.current = true;
    setStatus("pending");
    void controller.continueGoogleBackedIdentityAction({
      kind: "detach_google_backed_identity",
      publicIdentity,
      expectedGoogleAccountId,
    })
      .then((completed) => {
        if (completed.status !== "action_completed"
          || Result.isError(completed.result)
          || completed.result.value.kind !== "google_backed_identity_detached") {
          setStatus("error");
          return;
        }
        setStatus("complete");
      })
      .catch(() => setStatus("error"))
      .finally(() => { dispatching.current = false; });
  }, [authorizationReady, controller, expectedGoogleAccountId, publicIdentity]);

  const retryAuthorization = useCallback(() => {
    setStatus("preparing");
    controller.retryGoogleAuthorization();
  }, [controller]);

  useEffect(() => {
    void controller.prepareGoogleAuthorization((state) => {
      updateStatusFromController(state, dispatching.current, setAuthorizationReady, setStatus);
    }).catch(() => setStatus("error"));
    return () => { try { controller.disposeGoogleAuthorization(); } catch { /* Controller owns cleanup logging. */ } };
  }, [controller]);

  return {
    canDetach: authorizationReady && status !== "pending",
    canRetryAuthorization: status === "error" && !authorizationReady,
    detach,
    retryAuthorization,
    status,
  };
}

function updateStatusFromController(
  state: GoogleBackedIdentityActionState,
  dispatching: boolean,
  setAuthorizationReady: (ready: boolean) => void,
  setStatus: (status: DetachFromGoogleStatus) => void,
): void {
  if (state.stage === "google-authorization") {
    if (state.errorCode !== null) setStatus("error");
    else {
      setAuthorizationReady(true);
      if (!dispatching) setStatus("ready");
    }
    return;
  }
  if (state.stage === "requesting-google-authorization" || state.stage === "detaching-google-backed-identity") {
    setStatus("pending");
  }
}

export { useDetachFromGoogle };
