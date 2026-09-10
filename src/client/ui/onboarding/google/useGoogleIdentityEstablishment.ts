import { Result } from "better-result";
import { useState } from "react";

import type { GoogleAccountProfile } from "../../../../libs/googleAccountProfile";
import type {
  GoogleIdentityProgress,
  GoogleIdentityViewError,
} from "../../../logic/google-identity/GoogleIdentityController";
import type { PubkyPublicIdentity } from "../../../logic/pubky/pubkyIdentityKey";
import { useGoogleIdentityController } from "../../useGoogleIdentityController";

type GoogleIdentityEstablishmentView =
  | { status: "idle" }
  | { status: "requesting-access" }
  | { status: "failed"; error: GoogleIdentityViewError }
  | { status: "working"; progress: GoogleIdentityProgress }
  | {
      status: "complete";
      googleAccount: GoogleAccountProfile;
      identity: PubkyPublicIdentity;
      mode: "created" | "restored";
      visibleRecoveryCopyStatus: "created" | "unconfirmed" | null;
    };

const OPERATION_FAILED: GoogleIdentityEstablishmentView = {
  status: "failed",
  error: { code: "operation_failed" },
};

function useGoogleIdentityEstablishment() {
  const [view, setView] = useState<GoogleIdentityEstablishmentView>({ status: "idle" });
  const controller = useGoogleIdentityController({
    disposeOperation: "establishment_controller_dispose",
    failureEvent: "identity.google.establishment_ui.failed",
    onControllerState: (nextState) => {
      if (nextState.status === "requesting-authorization") {
        setView({ status: "requesting-access" });
      } else if (nextState.status === "establishing") {
        setView({ status: "working", progress: nextState.progress });
      }
    },
    onUnavailable: () => setView(OPERATION_FAILED),
  });

  const startIdentityOperation = (operation: "establish" | "replace-invalid-file") => {
    controller.startOperation({
      operation,
      start: (googleIdentity) => {
        setView({ status: "requesting-access" });
        return operation === "establish"
          ? googleIdentity.establishIdentity()
          : googleIdentity.replaceInvalidPassportFile();
      },
      onSettled: (result) => {
        if (Result.isError(result)) {
          if (result.error.code !== "cancelled") {
            setView({ status: "failed", error: result.error });
          }
          return;
        }

        setView({
          status: "complete",
          googleAccount: result.value.googleAccount,
          identity: result.value.publicIdentity,
          mode: result.value.establishmentMode,
          visibleRecoveryCopyStatus:
            result.value.establishmentMode === "created"
              ? result.value.visibleRecoveryCopyStatus
              : null,
        });
      },
      onRejected: () => setView(OPERATION_FAILED),
    });
  };

  const back = () => {
    controller.abandonOperation();
    controller.getController()?.clearPinnedGoogleSubject();
    setView({ status: "idle" });
  };

  return {
    back,
    establishIdentity: () => startIdentityOperation("establish"),
    replaceInvalidPassportFile: () => startIdentityOperation("replace-invalid-file"),
    view,
  };
}

export { useGoogleIdentityEstablishment };
