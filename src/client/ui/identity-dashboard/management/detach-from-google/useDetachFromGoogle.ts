import { Result } from "better-result";
import { useState } from "react";

import type { GoogleIdentityViewError } from "../../../../logic/google-identity/GoogleIdentityController";
import type { PubkyPublicIdentity } from "../../../../logic/pubky/pubkyIdentityKey";
import { useGoogleIdentityController } from "../../../useGoogleIdentityController";

type DetachFromGoogleOperationState =
  | { status: "ready" }
  | { status: "requesting-authorization" }
  | { status: "detaching" }
  | { status: "authorization-failed" }
  | { status: "operation-failed"; error: GoogleIdentityViewError }
  | { status: "complete" };

const OPERATION_FAILED: DetachFromGoogleOperationState = {
  status: "operation-failed",
  error: { code: "operation_failed" },
};

function useDetachFromGoogle(publicIdentity: PubkyPublicIdentity, expectedGoogleSubject: string) {
  const [state, setState] = useState<DetachFromGoogleOperationState>({ status: "ready" });
  const controller = useGoogleIdentityController({
    disposeOperation: "detachment_controller_dispose",
    failureEvent: "identity.google.detachment_ui.failed",
    onControllerState: (nextState) => {
      if (nextState.status === "requesting-authorization") {
        setState({ status: "requesting-authorization" });
      } else if (nextState.status === "detaching") {
        setState({ status: "detaching" });
      }
    },
    onUnavailable: () => setState(OPERATION_FAILED),
  });

  const detach = () => {
    const canStartDetachment =
      state.status === "ready" ||
      state.status === "authorization-failed" ||
      state.status === "operation-failed";
    if (!canStartDetachment) return;
    if (!expectedGoogleSubject.trim()) {
      setState(OPERATION_FAILED);
      return;
    }

    controller.startOperation({
      operation: "detach",
      start: (googleIdentity) => {
        setState({ status: "requesting-authorization" });
        return googleIdentity.detachIdentity(publicIdentity, expectedGoogleSubject);
      },
      onSettled: (completed) => {
        if (Result.isError(completed)) {
          if (completed.error.code === "cancelled") return;
          setState(
            completed.error.code === "authorization_failed"
              ? { status: "authorization-failed" }
              : { status: "operation-failed", error: completed.error },
          );
          return;
        }
        setState({ status: "complete" });
      },
      onRejected: () => setState(OPERATION_FAILED),
    });
  };

  return { detach, state };
}

export { useDetachFromGoogle };
