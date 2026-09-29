import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";
import type {
  GoogleIdentityBackup,
  GoogleIdentityViewState,
} from "@/client/logic/google-identity/GoogleIdentityController";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import {
  googlePermissionPromptMode,
  type GooglePermissionPromptMode,
} from "@/client/ui/googlePermissionPromptMode";
import { useGoogleIdentityStore } from "@/client/ui/useGoogleIdentityStore";

type BackupToGoogleState =
  | { status: "ready" }
  /** Google's window is open and waits for the person. */
  | { status: "authorizing" }
  | { status: "pending" }
  | { status: "permission-required"; mode: GooglePermissionPromptMode }
  | { status: "failed"; error: GoogleIdentityViewError }
  | { status: "complete"; backup: GoogleIdentityBackup };

/** Attaches a local identity to a Google account through the screen's own controller. */
function useBackupToGoogle(publicIdentity: PubkyPublicIdentity) {
  const google = useGoogleIdentityStore("backup");
  const state = toBackupState(google.state);

  const backup = () => {
    google.run("backup", (controller) => controller.backupIdentity(publicIdentity));
  };

  return {
    backup,
    cancelAuthorization: google.cancelAuthorization,
    showAuthorizationWindow: google.showAuthorizationWindow,
    continueWithoutVisibleBackup: () => {
      google.run("continue-without-visible-backup", (controller) =>
        controller.continueBackupWithoutVisibleCopy(),
      );
    },
    /**
     * Starts over with a fresh account choice, except after a backup that was saved but not
     * linked: only the same Google account can finish that link.
     */
    retry: () => {
      if (state.status !== "failed" || state.error.code !== "google_backup_created_not_linked") {
        google.reset();
      }
      backup();
    },
    state,
  };
}

function toBackupState(state: GoogleIdentityViewState): BackupToGoogleState {
  switch (state.status) {
    case "requesting-authorization":
      return { status: "authorizing" };
    case "backing-up":
      return { status: "pending" };
    case "backed-up":
      return { status: "complete", backup: state.backup };
    case "failed": {
      const mode = googlePermissionPromptMode(state.error.code, "backup");
      return mode === undefined
        ? { status: "failed", error: state.error }
        : { status: "permission-required", mode };
    }
    case "idle":
    case "establishing":
    case "established":
    case "detaching":
    case "detached":
      return { status: "ready" };
  }
}

export { useBackupToGoogle };
