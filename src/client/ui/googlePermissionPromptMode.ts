import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";

/** Which variant of `GoogleDrivePermissionPrompt` a failure calls for. */
export type GooglePermissionPromptMode = "required" | "optional" | "detach";

/**
 * The single classification of Google failures that a Drive permission prompt resolves, per
 * operation; `undefined` when the failure needs another screen. Detachment always asks for both
 * permissions. Establishment has its own screen for a denied authorization.
 */
export function googlePermissionPromptMode(
  code: GoogleIdentityViewError["code"],
  operation: "establish" | "backup" | "detach",
): GooglePermissionPromptMode | undefined {
  switch (code) {
    case "google_detachment_permission_required":
      return operation === "detach" ? "detach" : undefined;
    case "google_authorization_denied":
      if (operation === "establish") return undefined;
      return operation === "detach" ? "detach" : "required";
    case "google_drive_access_required":
      return operation === "detach" ? "detach" : "required";
    case "visible_backup_permission_missing":
      return operation === "detach" ? undefined : "optional";
    default:
      return undefined;
  }
}
