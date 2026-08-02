import "client-only";

/**
 * A phase starts when it is reported; a later phase means prior phases on that
 * branch completed. Values stay payload-free so sensitive data cannot enter UI state.
 */
export type GoogleBackedIdentityProgress =
  | "preparing_secure_identity"
  | "checking_passport_file"
  | "preparing_new_identity"
  | "creating_identity"
  | "storing_encrypted_identity"
  | "signing_up_to_homeserver"
  | "publishing_discovery"
  | "activating_created_identity"
  | "restoring_identity"
  | "activating_restored_identity";

export type ReportGoogleBackedIdentityProgress = (
  progress: GoogleBackedIdentityProgress,
) => void;
