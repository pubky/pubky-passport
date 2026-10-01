import { describe, expect, it } from "vitest";

import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";
import { googleIdentityErrorMessage } from "./googleIdentityErrorMessage";

/** Every view code with its user copy; the `Record` keeps this table exhaustive at compile time. */
const EXPECTED_COPY: Record<GoogleIdentityViewError["code"], string> = {
  authorization_failed: "Could not connect to Google. Try again.",
  cancelled: "Passport could not finish this operation. Please try again.",
  create_failed: "Passport could not create a new Pubky identity.",
  decrypt_failed: "Passport found your encrypted identity, but could not decrypt it.",
  drive_create_conflict:
    "Another Passport identity file was created at the same time. Check the Google account and try again.",
  drive_read_failed: "Passport could not read your encrypted identity from Google Drive.",
  drive_write_failed: "Passport could not save your encrypted identity to Google Drive.",
  encrypt_failed: "Passport created an identity, but could not encrypt it for Google Drive.",
  google_account_mismatch: "Could not remove Google access. Please try again.",
  google_authorization_denied: "Passport needs access to your Google Drive to continue.",
  google_drive_access_required:
    "Passport needs permission to store its encrypted identity in Google Drive. Select the configuration-data checkbox and try again.",
  google_authorization_failed: "Could not connect to Google. Try again.",
  google_authorization_popup_closed:
    "The Google authorization window was closed before access was granted.",
  google_authorization_popup_failed_to_open:
    "Passport could not open the Google authorization window. Check your popup settings and try again.",
  google_drive_cleanup_failed: "Could not remove Google access. Please try again.",
  google_detachment_permission_required:
    "Passport needs both Google Drive permissions to delete your encrypted identity and visible recovery copies before removing Google access.",
  homeserver_signup_token_failed: "Passport could not obtain a homeserver invitation.",
  identity_mismatch: "The restored Pubky identity did not match the activated homeserver identity.",
  invalid_passport_file:
    "Passport found your encrypted identity file in Google Drive, but it is damaged and cannot be restored.",
  invalid_passport_file_delete_failed:
    "Passport could not delete the invalid identity file from Google Drive. You can try deleting it again.",
  undecryptable_passport_file_delete_failed:
    "Passport could not delete the identity file it cannot decrypt from Google Drive. You can try deleting it again.",
  local_remove_failed: "Could not remove Google access. Please try again.",
  local_save_failed: "Your identity was activated, but could not be saved in this browser.",
  operation_failed: "Passport could not finish this operation. Please try again.",
  publication_failed: "Passport could not publish your identity's PKDNS records.",
  restore_failed: "Passport could not restore the Pubky identity from the encrypted file.",
  signin_failed: "Passport found your encrypted identity, but could not sign in to its homeserver.",
  signup_failed: "Passport found your encrypted identity, but could not finish homeserver setup.",
  unexpected_failure: "Passport could not finish this operation. Please try again.",
  wrapping_key_failed:
    "Passport could not unlock your encrypted identity with this Google account.",
  visible_backup_permission_missing:
    "Passport can continue, but it will not create a visible recovery copy in Google Drive unless you grant the second permission.",
};

describe("googleIdentityErrorMessage", () => {
  it.each(Object.entries(EXPECTED_COPY) as [GoogleIdentityViewError["code"], string][])(
    "maps %s to its user copy",
    (code, copy) => {
      const message = googleIdentityErrorMessage(code);

      expect(message).toBe(copy);
      expect(message).not.toContain("_");
      expect(message.endsWith(".")).toBe(true);
    },
  );
});
