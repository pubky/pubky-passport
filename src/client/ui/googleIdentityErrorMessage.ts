import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";

type GoogleIdentityErrorCode = GoogleIdentityViewError["code"];
type GoogleIdentityErrorDetail = GoogleIdentityViewError["detailCode"];

/**
 * The operation that failed. Creating or restoring an identity uses the default copy; attaching and
 * detaching replace it for some codes, and detaching names the Google account being removed.
 */
type GoogleIdentityErrorContext =
  { operation: "establish" } | { operation: "attach" } | { operation: "detach"; email: string };

/**
 * What the person can do after Google setup failed, and whether trying the same step again can
 * help. `nextStep` is omitted where the cause already ends with it.
 */
type GoogleIdentityErrorRecovery = { nextStep?: string; retryHelps: boolean };

/** A failure whose cause and way out both depend on its detail code. */
type DetailedFailure = { cause: string } & GoogleIdentityErrorRecovery;

type GoogleIdentityErrorFacts = Pick<GoogleIdentityViewError, "code" | "detailCode" | "flow">;

/**
 * Copy that replaces the default when the failure happened while attaching a local identity to
 * a Google account. Codes missing here fall back to the default copy.
 */
const ATTACH_COPY: Partial<Record<GoogleIdentityErrorCode, string>> = {
  // The identity is bound to another account, or a backup this page saved there is not linked yet.
  google_account_mismatch:
    "This pubky is already backed up to a different Google account. Try again and choose that account in Google’s window.",
  drive_read_failed:
    "Passport could not check this Google account for an existing Passport backup. Try again.",
  wrapping_key_failed:
    "Passport could not get an encryption key for this Google account. Nothing was saved to Google Drive. Try again.",
  local_identity_unavailable:
    "Passport could not read this identity from this browser, so nothing was saved to Google Drive. Reload the page and try again.",
};

/** Copy for detaching that names the Google account whose backup is being removed. */
function detachCopy(code: GoogleIdentityErrorCode, email: string): string | undefined {
  switch (code) {
    case "google_account_mismatch":
      return `You chose a different Google account. To remove this backup, choose ${email} in Google’s window.`;
    case "google_drive_cleanup_failed":
      return `Passport couldn’t finish deleting the backup from Google Drive. This pubky is still attached to ${email}. Try again.`;
    default:
      return undefined;
  }
}

/**
 * Single mapping from a Google identity view error to user-facing copy that says what happened
 * and, where it matters, what was kept. The switch has no default branch on purpose: a new code
 * fails typechecking until it receives deliberate copy.
 */
function googleIdentityErrorMessage(
  error: GoogleIdentityErrorFacts,
  context: GoogleIdentityErrorContext = { operation: "establish" },
): string {
  const { code, detailCode } = error;
  const contextCopy =
    context.operation === "attach"
      ? ATTACH_COPY[code]
      : context.operation === "detach"
        ? detachCopy(code, context.email)
        : undefined;
  if (contextCopy !== undefined) return contextCopy;
  switch (code) {
    case "create_failed":
      return "Passport couldn’t create a new identity.";
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
      return "Passport signed in as a different pubky than the one in your Google Drive backup, so it stopped.";
    case "restore_failed":
      return "Passport couldn’t restore the identity from your Google Drive backup.";
    // Both happen once the encrypted backup is in Drive, for a new pubky as for a restored one.
    case "signin_failed":
      return "Your pubky is saved, encrypted, in your Google Drive, but Passport couldn’t sign in to its homeserver.";
    case "signup_failed":
      return "Your pubky is saved, encrypted, in your Google Drive, but its homeserver didn’t finish setting it up. Try again and Passport will finish setting up the same pubky.";
    case "publication_failed":
      return "Passport couldn’t publish your pubky, so apps can’t find it yet.";
    case "local_save_failed":
      return "Your pubky is set up and backed up to Google Drive, but this browser didn’t let Passport save it (storage may be full or blocked).";
    case "local_identity_held_by_ring":
      return "This pubky is connected through Pubky Ring in this browser, so Passport left it there and did not save the key from your Google Drive backup. To keep the key in this browser instead, remove the Pubky Ring entry, then continue with Google again.";
    case "local_identity_unavailable":
      return "Passport could not read this identity from this browser, so nothing was removed from Google Drive. Reload the page and try again.";
    case "local_identity_not_bound":
      return "This identity is no longer stored in this browser with this Google account, so nothing was removed from Google Drive. Reload the page and try again.";
    case "local_unlink_failed":
      return "Your Google Drive backup was removed, but Passport could not update this browser. Try again to finish removing Google access.";
    case "wrapping_key_failed":
      return wrappingKeyFailure(detailCode).cause;
    case "homeserver_signup_token_failed":
      return signupInvitationFailure(error).cause;
    // Also after a replacement deleted the old backup, so it doesn't claim nothing changed.
    case "homeserver_unreachable":
      return "The homeserver isn’t answering right now, so Passport stopped before setting up your pubky. Try again later.";
    case "homeserver_invite_rejected":
      return "The homeserver did not accept the invitation Passport received for your new identity, so nothing was saved to Google Drive. The operator of this Passport may need to check its invitations.";
    case "invalid_passport_file":
      return "Passport found a backup in your Google Drive, but it’s damaged and can’t be restored.";
    case "passport_file_undecryptable":
      return "Passport found a backup in your Google Drive, but can no longer unlock it with this Google account.";
    case "foreign_passport_file":
      return "This Google account already has a Passport identity file that names another Passport site. This Passport cannot unlock it and has not changed it.";
    case "invalid_passport_file_delete_failed":
      return "Passport couldn’t delete the damaged backup from Google Drive, so no new pubky was created.";
    case "undecryptable_passport_file_delete_failed":
      return "Passport couldn’t delete the backup it can no longer unlock from Google Drive, so no new pubky was created.";
    case "google_authorization_denied":
      return "Passport needs access to your Google Drive to continue.";
    case "google_drive_access_required":
      return "Passport needs permission to store its encrypted identity in Google Drive. Select the configuration-data checkbox and try again.";
    case "google_detachment_permission_required":
      return "Passport needs both Google Drive permissions to delete your encrypted backup and its copy in your “Pubky Passport” folder before removing Google access.";
    case "visible_backup_permission_missing":
      return "Passport can continue, but it won’t put a copy of your backup in a “Pubky Passport” folder in your Google Drive unless you tick the second box.";
    case "google_authorization_popup_closed":
      return "You closed Google’s window before finishing. Nothing was created or changed.";
    case "google_authorization_popup_failed_to_open":
      return "Passport could not open the Google authorization window. Check your popup settings and try again.";
    case "google_authorization_failed":
    case "authorization_failed":
      return "Could not connect to Google. Try again.";
    case "google_account_mismatch":
      return "You chose a different Google account than the one you started with. Try again and choose the same account.";
    case "google_drive_cleanup_failed":
      return "Passport couldn’t finish deleting the backup from Google Drive, so Google access was not removed. Try again.";
    case "cancelled":
    case "operation_failed":
    case "unexpected_failure":
      return "Passport could not finish this operation. Please try again.";
  }
}

const ANOTHER_GOOGLE_ACCOUNT = "Go back and choose another Google account.";
const RETRY_OR_ANOTHER_WAY = "Try again. If it keeps failing, go back and choose another option.";
const SIGN_IN_AGAIN = "Try again and sign in once more.";
/** Where Google can’t create a pubky there is nothing to restore either, but the other ways in work. */
const NO_BACKUP = "There’s no Passport backup to restore in this Google account.";
const OTHER_WAYS_IN = "Go back to create an account or sign in with Pubky Ring.";

/**
 * The next step for the Google setup error screen. File failures that Passport verified cannot be
 * retried away; only deleting the file (when offered) or another Google account resolves them.
 */
function googleIdentityErrorRecovery(
  error: GoogleIdentityErrorFacts,
  { canReplaceFile }: { canReplaceFile: boolean },
): GoogleIdentityErrorRecovery {
  switch (error.code) {
    case "homeserver_signup_token_failed":
      return recoveryOf(signupInvitationFailure(error));
    case "wrapping_key_failed":
      return recoveryOf(wrappingKeyFailure(error.detailCode));
    case "invalid_passport_file":
    case "passport_file_undecryptable":
      return {
        nextStep: canReplaceFile
          ? "Delete this backup and start over with a new pubky, or go back and choose another Google account."
          : ANOTHER_GOOGLE_ACCOUNT,
        retryHelps: false,
      };
    // Signing in again would find the same file; deleting it again can succeed.
    case "invalid_passport_file_delete_failed":
    case "undecryptable_passport_file_delete_failed":
      return {
        nextStep: canReplaceFile
          ? "Try deleting it again, or go back and choose another Google account."
          : ANOTHER_GOOGLE_ACCOUNT,
        retryHelps: false,
      };
    case "foreign_passport_file":
      return { nextStep: ANOTHER_GOOGLE_ACCOUNT, retryHelps: false };
    // Trying again restores into the same Ring entry; the cause says how to go on.
    case "local_identity_held_by_ring":
      return { retryHelps: false };
    case "homeserver_invite_rejected":
      return {
        nextStep: "Try again later, or go back and create your account another way.",
        retryHelps: true,
      };
    case "signin_failed":
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
          "Allow this site to store data (private windows may not), then try again. Passport will restore your pubky from Google Drive.",
        retryHelps: true,
      };
    // The cause already says what to do.
    case "signup_failed":
    case "google_account_mismatch":
    case "google_authorization_popup_closed":
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

function recoveryOf({ nextStep, retryHelps }: DetailedFailure): GoogleIdentityErrorRecovery {
  return nextStep === undefined ? { retryHelps } : { nextStep, retryHelps };
}

/**
 * The wrapping key comes from Passport's server once it has checked a fresh Google sign-in, before
 * Passport restores or creates a pubky. Deleting a damaged or unreadable backup comes first,
 * though, so the copy says what didn't happen, never that nothing changed.
 */
function wrappingKeyFailure(detailCode: GoogleIdentityErrorDetail): DetailedFailure {
  switch (detailCode) {
    // Passport was updated while this page was open: only a fresh page can sign in.
    case "reload_required":
      return {
        cause: "Passport was updated while this page was open, so it couldn’t finish with Google.",
        nextStep: "Reload the page, then try again.",
        retryHelps: false,
      };
    case "invalid_google_id_token":
      return {
        cause: "Your Google sign-in expired before Passport could restore or create your pubky.",
        nextStep: SIGN_IN_AGAIN,
        retryHelps: true,
      };
    case "google_verifier_unavailable":
    case "internal_error":
    case "invalid_response":
    case "key_derivation_failed":
    case "network_failed":
      return {
        cause:
          "Passport can’t check your Google sign-in right now, so it couldn’t restore or create your pubky.",
        nextStep: "Check your connection, then try again in a few minutes.",
        retryHelps: true,
      };
    default:
      return {
        cause: "Passport could not unlock your encrypted identity with this Google account.",
        nextStep: RETRY_OR_ANOTHER_WAY,
        retryHelps: true,
      };
  }
}

/**
 * Homegate's invitation, asked for to create a new pubky or to finish setting up one restored from
 * Drive whose homeserver signup never completed (`flow`). Sign-up limits count new identities per
 * Google account over rolling windows; a regional block comes from the deployment's proxy.
 */
function signupInvitationFailure({
  detailCode,
  flow,
}: Pick<GoogleIdentityErrorFacts, "detailCode" | "flow">): DetailedFailure {
  return flow === "repair"
    ? repairInvitationFailure(detailCode)
    : newPubkyInvitationFailure(detailCode);
}

/**
 * Creating asks for the invitation before writing anything, and only once Drive holds no backup
 * (none was found, or a replacement just deleted it), so nothing was created and there is nothing
 * to restore with this Google account.
 */
function newPubkyInvitationFailure(detailCode: GoogleIdentityErrorDetail): DetailedFailure {
  switch (detailCode) {
    case "weekly_limit_exceeded":
      return {
        cause:
          "This Google account has reached its weekly limit for new pubkys, so nothing was created.",
        nextStep: `${NO_BACKUP} Try again next week, or go back to create an account or sign in with Pubky Ring.`,
        retryHelps: false,
      };
    case "annual_limit_exceeded":
      return {
        cause:
          "This Google account has reached its yearly limit for new pubkys, so nothing was created.",
        nextStep: `${NO_BACKUP} ${OTHER_WAYS_IN}`,
        retryHelps: false,
      };
    case "blocked":
      return {
        cause: "New Google sign-ups aren’t available in your country, so nothing was created.",
        nextStep: `${NO_BACKUP} ${OTHER_WAYS_IN}`,
        retryHelps: false,
      };
    case "homeserver_unavailable":
    case "google_verifier_unavailable":
    case "homegate_unavailable":
    case "network_failed":
      return {
        cause: "The sign-up service isn’t answering right now, so nothing was created.",
        nextStep: "Wait a few minutes, then try again.",
        retryHelps: true,
      };
    case "invalid_homegate_homeserver":
      return {
        cause:
          "The sign-up service didn’t say which homeserver your pubky belongs on, so nothing was created.",
        nextStep:
          "Try again later. If it keeps failing, go back and create your account another way.",
        retryHelps: true,
      };
    case "invalid_google_id_token":
      return {
        cause: "Your Google sign-in expired before Passport could finish, so nothing was created.",
        nextStep: SIGN_IN_AGAIN,
        retryHelps: true,
      };
    default:
      return {
        cause: "Passport couldn’t get an invitation to create your pubky, so nothing was created.",
        nextStep: "Try again. If it keeps failing, go back and create your account another way.",
        retryHelps: true,
      };
  }
}

/**
 * Finishing a pubky restored from Drive: the pubky exists and stays in the person's Drive, so the
 * copy says it is safe and never suggests creating another one. Only its homeserver signup waits.
 */
function repairInvitationFailure(detailCode: GoogleIdentityErrorDetail): DetailedFailure {
  const safe = "Your pubky is safe in your Google Drive, but Passport can’t finish setting it up";
  switch (detailCode) {
    case "weekly_limit_exceeded":
      return {
        cause: `${safe} with its server: this Google account has reached its weekly sign-up limit. Nothing was lost.`,
        nextStep: "Try again next week.",
        retryHelps: false,
      };
    case "annual_limit_exceeded":
      return {
        cause: `${safe} with its server: this Google account has reached its yearly sign-up limit. Nothing was lost.`,
        nextStep: "Try again once the yearly limit resets.",
        retryHelps: false,
      };
    case "blocked":
      return {
        cause: `${safe} with its server: new Google sign-ups aren’t available in your country. Nothing was lost.`,
        retryHelps: false,
      };
    case "homeserver_unavailable":
    case "google_verifier_unavailable":
    case "homegate_unavailable":
    case "network_failed":
      return {
        cause: `${safe} while the sign-up service isn’t answering. Nothing was lost.`,
        nextStep: "Wait a few minutes, then try again.",
        retryHelps: true,
      };
    case "invalid_homegate_homeserver":
      return {
        cause: `${safe} with its server: the sign-up service didn’t say which homeserver it belongs on. Nothing was lost.`,
        nextStep: "Try again later.",
        retryHelps: true,
      };
    case "invalid_google_id_token":
      return {
        cause:
          "Your Google sign-in expired before Passport could finish setting up your pubky. It’s safe in your Google Drive.",
        nextStep: SIGN_IN_AGAIN,
        retryHelps: true,
      };
    default:
      return {
        cause: `${safe} with its server right now. Nothing was lost.`,
        nextStep: "Try again in a few minutes.",
        retryHelps: true,
      };
  }
}

export { googleIdentityErrorMessage, googleIdentityErrorRecovery, type GoogleIdentityErrorContext };
