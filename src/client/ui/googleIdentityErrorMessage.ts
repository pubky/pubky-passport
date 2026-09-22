import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";

/**
 * Single mapping from a Google identity view code to user-facing copy. The switch has no
 * default branch on purpose: a new code fails typechecking until it receives deliberate copy.
 */
function googleIdentityErrorMessage(code: GoogleIdentityViewError["code"]): string {
  switch (code) {
    case "create_failed":
      return "Passport could not create a new Pubky identity.";
    case "decrypt_failed":
      return "Passport found your encrypted identity, but could not decrypt it.";
    case "drive_create_conflict":
      return "Another Passport identity file was created at the same time. Check the Google account and try again.";
    case "drive_read_failed":
      return "Passport could not read your encrypted identity from Google Drive.";
    case "drive_write_failed":
      return "Passport could not save your encrypted identity to Google Drive.";
    case "encrypt_failed":
      return "Passport created an identity, but could not encrypt it for Google Drive.";
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
    case "wrapping_key_failed":
      return "Passport could not unlock your encrypted identity with this Google account.";
    case "homeserver_signup_token_failed":
      return "Passport could not obtain a homeserver invitation.";
    case "invalid_passport_file":
      return "Passport found your encrypted identity file in Google Drive, but it is damaged and cannot be restored.";
    case "invalid_passport_file_delete_failed":
      return "Passport could not delete the invalid identity file from Google Drive. You can try deleting it again.";
    case "google_authorization_denied":
      return "Passport needs access to your Google Drive to continue.";
    case "google_drive_access_required":
      return "Passport needs permission to store its encrypted identity in Google Drive. Select the configuration-data checkbox and try again.";
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
    case "local_remove_failed":
      return "Could not remove Google access. Please try again.";
    case "cancelled":
    case "operation_failed":
    case "unexpected_failure":
      return "Passport could not finish this operation. Please try again.";
  }
}

export { googleIdentityErrorMessage };
