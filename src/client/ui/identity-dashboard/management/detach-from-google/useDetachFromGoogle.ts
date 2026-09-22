import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";
import type { GoogleIdentityViewState } from "@/client/logic/google-identity/GoogleIdentityController";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import { useGoogleIdentityStore } from "@/client/ui/useGoogleIdentityStore";

type DetachFromGoogleOperationState =
  | { status: "ready" }
  | { status: "requesting-authorization" }
  | { status: "detaching" }
  | { status: "authorization-failed"; error: GoogleIdentityViewError }
  | { status: "operation-failed"; error: GoogleIdentityViewError }
  | { status: "complete" };

function useDetachFromGoogle(publicIdentity: PubkyPublicIdentity, expectedGoogleSubject: string) {
  const google = useGoogleIdentityStore("detachment");

  const detach = () => {
    if (!expectedGoogleSubject.trim()) {
      google.fail();
      return;
    }
    google.run("detach", (controller) =>
      controller.detachIdentity(publicIdentity, expectedGoogleSubject),
    );
  };

  return { detach, retryDetachment: detach, state: toDetachmentState(google.state) };
}

function toDetachmentState(state: GoogleIdentityViewState): DetachFromGoogleOperationState {
  switch (state.status) {
    case "requesting-authorization":
      return { status: "requesting-authorization" };
    case "detaching":
      return { status: "detaching" };
    case "detached":
      return { status: "complete" };
    case "failed":
      return state.error.code === "authorization_failed"
        ? { status: "authorization-failed", error: state.error }
        : { status: "operation-failed", error: state.error };
    case "idle":
    case "establishing":
    case "established":
      return { status: "ready" };
  }
}

export { useDetachFromGoogle };
