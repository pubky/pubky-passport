import type { GoogleAccountProfile } from "@/libs/googleAccountProfile";
import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";
import type {
  GoogleIdentityProgress,
  GoogleIdentityViewState,
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
      mode: "created" | "restored";
      visibleRecoveryCopyStatus: "created" | "unconfirmed" | null;
    };

function useGoogleIdentityEstablishment() {
  const google = useGoogleIdentityStore("establishment");

  return {
    back: google.reset,
    establishIdentity: () =>
      google.run("establish", (controller) => controller.establishIdentity()),
    replaceInvalidPassportFile: () =>
      google.run("replace-invalid-file", (controller) => controller.replaceInvalidPassportFile()),
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
      return {
        status: "complete",
        googleAccount: state.identity.googleAccount,
        identity: state.identity.publicIdentity,
        mode: state.identity.establishmentMode,
        visibleRecoveryCopyStatus:
          state.identity.establishmentMode === "created"
            ? state.identity.visibleRecoveryCopyStatus
            : null,
      };
    case "idle":
    case "detaching":
    case "detached":
      return { status: "idle" };
  }
}

export { useGoogleIdentityEstablishment };
