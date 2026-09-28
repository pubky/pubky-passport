import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";

/** Screen that shows the failure; some codes need different copy when attaching a backup. */
type GoogleIdentityErrorContext = "default" | "attach";

/**
 * Copy that replaces the default when the failure happened while attaching a local identity to
 * a Google account. Codes missing here fall back to the default copy.
 */
const ATTACH_COPY: Partial<Record<GoogleIdentityViewError["code"], string>> = {
  google_account_mismatch:
    "This identity is already attached to a different Google account. Sign in with that account or remove Google access first.",
  drive_read_failed:
    "Passport could not check this Google account for an existing Passport backup. Try again.",
  wrapping_key_failed:
    "Passport could not get an encryption key for this Google account. Nothing was saved to Google Drive. Try again.",
  local_identity_unavailable:
    "Passport could not read this identity from this browser, so nothing was saved to Google Drive. Reload the page and try again.",
};

/**
 * Single mapping from a Google identity view code to user-facing copy. The switch has no
 * default branch on purpose: a new code fails typechecking until it receives deliberate copy.
 */
function googleIdentityErrorMessage(
  code: GoogleIdentityViewError["code"],
  context: GoogleIdentityErrorContext = "default",
): string {
  if (context === "attach") {
    const attachCopy = ATTACH_COPY[code];
    if (attachCopy !== undefined) return attachCopy;
  }
  switch (code) {
    case "create_failed":
      return "Passport could not create a new Pubky identity.";
    case "decrypt_failed":
      return "Passport found your encrypted identity, but could not decrypt it.";
    case "drive_create_conflict":
      return "Another Passport identity file was created at the same time. Check the Google account and try again.";
    case "google_backup_conflict":
      return "This Google account already has a Passport backup, which has not been opened or changed. Choose another Google account, or use Continue with Google with this account to restore the identity it holds.";
    case "google_backup_created_not_linked":
      return "Your encrypted backup was saved to Google Drive, but Passport could not record the link in this browser. Try again to finish attaching the same Google account.";
    case "drive_read_failed":
      return "Passport could not read your encrypted identity from Google Drive.";
    case "drive_write_failed":
      return "Passport could not save your encrypted identity to Google Drive.";
    case "encrypt_failed":
      return "Passport could not encrypt your identity for Google Drive.";
    case "identity_mismatch":
      return "The restored Pubky identity did not match the activated homeserver identity.";
    case "restore_failed":
      return "Passport could not restore the Pubky identity from the encrypted file.";
    case "signin_failed":
      return "Passport found your encrypted identity, but could not sign in to its homeserver.";
    case "signup_failed":
      return "Passport found your encrypted identity, but could not finish homeserver setup.";
    case "publication_failed":
      return "Passport could not publish your identity's PKDNS records.";
    case "local_save_failed":
      return "Your identity was activated, but could not be saved in this browser.";
    case "local_identity_unavailable":
      return "Passport could not read this identity from this browser, so nothing was removed from Google Drive. Reload the page and try again.";
    case "local_identity_not_bound":
      return "This identity is no longer stored in this browser with this Google account, so nothing was removed from Google Drive. Reload the page and try again.";
    case "local_unlink_failed":
      return "Your Google Drive backup was removed, but Passport could not update this browser. Try again to finish removing Google access.";
    case "wrapping_key_failed":
      return "Passport could not unlock your encrypted identity with this Google account.";
    case "homeserver_signup_token_failed":
      return "Passport could not obtain a homeserver invitation.";
    case "homeserver_unreachable":
      return "The homeserver is not answering right now, so nothing was changed. Try again later.";
    case "homeserver_invite_rejected":
      return "The homeserver did not accept the invitation Passport received for your new identity, so nothing was saved to Google Drive. The operator of this Passport may need to check its invitations.";
    case "invalid_passport_file":
      return "Passport found your encrypted identity file in Google Drive, but it is damaged and cannot be restored.";
    case "passport_file_undecryptable":
      return "Passport found your encrypted identity file in Google Drive, but can no longer unlock it with this Google account.";
    case "foreign_passport_file":
      return "This Google account already has a Passport identity file that names another Passport site. This Passport cannot unlock it and has not changed it.";
    case "invalid_passport_file_delete_failed":
      return "Passport could not delete the invalid identity file from Google Drive. You can try deleting it again.";
    case "undecryptable_passport_file_delete_failed":
      return "Passport could not delete the identity file it cannot decrypt from Google Drive. You can try deleting it again.";
    case "google_authorization_denied":
      return "Passport needs access to your Google Drive to continue.";
    case "google_drive_access_required":
      return "Passport needs permission to store its encrypted identity in Google Drive. Select the configuration-data checkbox and try again.";
    case "google_detachment_permission_required":
      return "Passport needs both Google Drive permissions to delete your encrypted identity and visible recovery copies before removing Google access.";
    case "visible_backup_permission_missing":
      return "Passport can continue, but it will not create a visible recovery copy in Google Drive unless you grant the second permission.";
    case "google_authorization_popup_closed":
      return "The Google authorization window was closed before access was granted.";
    case "google_authorization_popup_failed_to_open":
      return "Passport could not open the Google authorization window. Check your popup settings and try again.";
    case "google_authorization_failed":
    case "authorization_failed":
      return "Could not connect to Google. Try again.";
    case "google_account_mismatch":
    case "google_drive_cleanup_failed":
      return "Could not remove Google access. Please try again.";
    case "cancelled":
    case "operation_failed":
    case "unexpected_failure":
      return "Passport could not finish this operation. Please try again.";
  }
}

/**
 * What the person can do after Google setup failed, and whether trying the same step again can
 * help. `nextStep` is omitted where the cause already ends with it.
 */
type GoogleIdentityErrorRecovery = { nextStep?: string; retryHelps: boolean };

const ANOTHER_GOOGLE_ACCOUNT = "Go back and choose another Google account.";
const RETRY_OR_ANOTHER_WAY = "Try again. If it keeps failing, go back and choose another option.";

/**
 * The next step for the Google setup error screen. File failures that Passport verified cannot be
 * retried away; only deleting the file (when offered) or another Google account resolves them.
 */
function googleIdentityErrorRecovery(
  error: Pick<GoogleIdentityViewError, "code" | "detailCode">,
  { canReplaceFile }: { canReplaceFile: boolean },
): GoogleIdentityErrorRecovery {
  switch (error.code) {
    case "homeserver_signup_token_failed":
      return signupInvitationRecovery(error.detailCode);
    case "invalid_passport_file":
    case "invalid_passport_file_delete_failed":
      return {
        nextStep: canReplaceFile
          ? "Delete the damaged file and create a new pubky, or go back and choose another Google account."
          : ANOTHER_GOOGLE_ACCOUNT,
        retryHelps: false,
      };
    case "passport_file_undecryptable":
    case "undecryptable_passport_file_delete_failed":
      return {
        nextStep: canReplaceFile
          ? "Delete the file and create a new pubky, or go back and choose another Google account."
          : ANOTHER_GOOGLE_ACCOUNT,
        retryHelps: false,
      };
    case "foreign_passport_file":
      return { nextStep: ANOTHER_GOOGLE_ACCOUNT, retryHelps: false };
    case "homeserver_invite_rejected":
      return {
        nextStep: "Try again later, or go back and create your account another way.",
        retryHelps: true,
      };
    case "signin_failed":
    case "signup_failed":
      return {
        nextStep: "The homeserver may be busy. Wait a few minutes, then try again.",
        retryHelps: true,
      };
    case "drive_read_failed":
    case "drive_write_failed":
    case "publication_failed":
      return { nextStep: "Check your connection, then try again.", retryHelps: true };
    case "local_save_failed":
      return {
        nextStep:
          "Make sure this browser lets Passport store data (private windows may not), then try again.",
        retryHelps: true,
      };
    case "google_authorization_popup_closed":
      return { nextStep: "Try again and finish signing in in Google’s window.", retryHelps: true };
    // The cause already says what to do.
    case "drive_create_conflict":
    case "homeserver_unreachable":
    case "google_authorization_popup_failed_to_open":
    case "google_authorization_failed":
    case "authorization_failed":
    case "cancelled":
    case "operation_failed":
    case "unexpected_failure":
      return { retryHelps: true };
    default:
      return { nextStep: RETRY_OR_ANOTHER_WAY, retryHelps: true };
  }
}

function signupInvitationRecovery(
  detailCode: GoogleIdentityViewError["detailCode"],
): GoogleIdentityErrorRecovery {
  // Sign-up limits count new identities per Google account over rolling windows.
  switch (detailCode) {
    case "weekly_limit_exceeded":
      return {
        nextStep:
          "This Google account has reached its weekly limit for new identities. Try again in a week, or go back and create your account another way.",
        retryHelps: false,
      };
    case "annual_limit_exceeded":
      return {
        nextStep:
          "This Google account has reached its yearly limit for new identities. Go back and create your account another way.",
        retryHelps: false,
      };
    case "homeserver_unavailable":
    case "google_verifier_unavailable":
    case "homegate_unavailable":
    case "network_failed":
      return {
        nextStep:
          "The sign-up service is not answering right now. Wait a few minutes, then try again.",
        retryHelps: true,
      };
    default:
      return {
        nextStep: "Try again. If it keeps failing, go back and create your account another way.",
        retryHelps: true,
      };
  }
}

export { googleIdentityErrorMessage, googleIdentityErrorRecovery };
