import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";
import type {
  GoogleIdentityProgress,
  GoogleIdentityViewState,
  VisibleRecoveryCopyStatus,
} from "@/client/logic/google-identity/GoogleIdentityController";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import { useGoogleIdentityStore } from "@/client/ui/useGoogleIdentityStore";

type GoogleIdentityEstablishmentView =
  | { status: "idle" }
  | { status: "requesting-access" }
  | { status: "failed"; error: GoogleIdentityViewError }
  | { status: "working"; progress: GoogleIdentityProgress }
  | {
      status: "complete";
      googleAccount: GoogleAccountProfile;
      identity: PubkyPublicIdentity;
      mode: "created";
      visibleRecoveryCopyStatus: VisibleRecoveryCopyStatus;
    }
  | {
      status: "complete";
      googleAccount: GoogleAccountProfile;
      identity: PubkyPublicIdentity;
      mode: "restored";
    };

function useGoogleIdentityEstablishment() {
  const google = useGoogleIdentityStore("establishment");

  return {
    back: google.reset,
    cancelAuthorization: google.cancelAuthorization,
    showAuthorizationWindow: google.showAuthorizationWindow,
    establishIdentity: () =>
      google.run("establish", (controller) => controller.establishIdentity()),
    continueWithoutVisibleBackup: () =>
      google.run("continue-without-visible-backup", (controller) =>
        controller.continueWithoutVisibleBackup(),
      ),
    replaceInvalidPassportFile: () =>
      google.run("replace-invalid-file", (controller) => controller.replaceInvalidPassportFile()),
    replaceUndecryptablePassportFile: () =>
      google.run("replace-undecryptable-file", (controller) =>
        controller.replaceUndecryptablePassportFile(),
      ),
    view: toEstablishmentView(google.state),
  };
}

function toEstablishmentView(state: GoogleIdentityViewState): GoogleIdentityEstablishmentView {
  switch (state.status) {
    case "requesting-authorization":
      return { status: "requesting-access" };
    case "establishing":
      return { status: "working", progress: state.progress };
    case "failed":
      return { status: "failed", error: state.error };
    case "established":
      return state.identity.establishmentMode === "created"
        ? {
            status: "complete",
            googleAccount: state.identity.googleAccount,
            identity: state.identity.publicIdentity,
            mode: "created",
            visibleRecoveryCopyStatus: state.identity.visibleRecoveryCopyStatus,
          }
        : {
            status: "complete",
            googleAccount: state.identity.googleAccount,
            identity: state.identity.publicIdentity,
            mode: "restored",
          };
    case "idle":
    case "detaching":
    case "detached":
    case "backing-up":
    case "backed-up":
      return { status: "idle" };
  }
}

export { useGoogleIdentityEstablishment };
