import { describe, expect, it } from "vitest";

import type { GoogleIdentityViewError } from "@/client/logic/google-identity/googleIdentityErrors";
import {
  googleIdentityErrorMessage,
  googleIdentityErrorRecovery,
} from "./googleIdentityErrorMessage";

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
  encrypt_failed: "Passport could not encrypt your identity for Google Drive.",
  google_backup_conflict:
    "This Google account already has a Passport backup, which has not been opened or changed. Choose another Google account, or use Continue with Google with this account to restore the identity it holds.",
  google_backup_created_not_linked:
    "Your encrypted backup was saved to Google Drive, but Passport could not record the link in this browser. Try again to finish attaching the same Google account.",
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
  homeserver_unreachable:
    "The homeserver is not answering right now, so nothing was changed. Try again later.",
  homeserver_invite_rejected:
    "The homeserver did not accept the invitation Passport received for your new identity, so nothing was saved to Google Drive. The operator of this Passport may need to check its invitations.",
  identity_mismatch: "The restored Pubky identity did not match the activated homeserver identity.",
  invalid_passport_file:
    "Passport found your encrypted identity file in Google Drive, but it is damaged and cannot be restored.",
  passport_file_undecryptable:
    "Passport found your encrypted identity file in Google Drive, but can no longer unlock it with this Google account.",
  foreign_passport_file:
    "This Google account already has a Passport identity file that names another Passport site. This Passport cannot unlock it and has not changed it.",
  invalid_passport_file_delete_failed:
    "Passport could not delete the invalid identity file from Google Drive. You can try deleting it again.",
  undecryptable_passport_file_delete_failed:
    "Passport could not delete the identity file it cannot decrypt from Google Drive. You can try deleting it again.",
  local_identity_unavailable:
    "Passport could not read this identity from this browser, so nothing was removed from Google Drive. Reload the page and try again.",
  local_identity_not_bound:
    "This identity is no longer stored in this browser with this Google account, so nothing was removed from Google Drive. Reload the page and try again.",
  local_save_failed: "Your identity was activated, but could not be saved in this browser.",
  local_unlink_failed:
    "Your Google Drive backup was removed, but Passport could not update this browser. Try again to finish removing Google access.",
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

  // Every code the attach (backup) operation can fail with, including authorization failures,
  // mapped to copy that describes attaching rather than restoring or detaching.
  it.each([
    [
      "google_account_mismatch",
      "This identity is already attached to a different Google account. Sign in with that account or remove Google access first.",
    ],
    [
      "drive_read_failed",
      "Passport could not check this Google account for an existing Passport backup. Try again.",
    ],
    [
      "wrapping_key_failed",
      "Passport could not get an encryption key for this Google account. Nothing was saved to Google Drive. Try again.",
    ],
    [
      "local_identity_unavailable",
      "Passport could not read this identity from this browser, so nothing was saved to Google Drive. Reload the page and try again.",
    ],
    ["google_backup_conflict", EXPECTED_COPY.google_backup_conflict],
    ["google_backup_created_not_linked", EXPECTED_COPY.google_backup_created_not_linked],
    ["encrypt_failed", EXPECTED_COPY.encrypt_failed],
    ["drive_create_conflict", EXPECTED_COPY.drive_create_conflict],
    ["drive_write_failed", EXPECTED_COPY.drive_write_failed],
    ["unexpected_failure", EXPECTED_COPY.unexpected_failure],
    ["authorization_failed", EXPECTED_COPY.authorization_failed],
    ["google_authorization_popup_closed", EXPECTED_COPY.google_authorization_popup_closed],
    ["operation_failed", EXPECTED_COPY.operation_failed],
  ] as const)("describes the attach failure %s in attach terms", (code, copy) => {
    expect(googleIdentityErrorMessage(code, "attach")).toBe(copy);
  });

  it("keeps the default copy outside the attach screen", () => {
    expect(googleIdentityErrorMessage("google_account_mismatch", "default")).toBe(
      EXPECTED_COPY.google_account_mismatch,
    );
    expect(googleIdentityErrorMessage("wrapping_key_failed")).toBe(
      EXPECTED_COPY.wrapping_key_failed,
    );
  });
});

describe("googleIdentityErrorRecovery", () => {
  const replaceable = { canReplaceFile: true };

  it.each([
    [
      "weekly_limit_exceeded",
      "This Google account has reached its weekly limit for new identities. Try again in a week, or go back and create your account another way.",
    ],
    [
      "annual_limit_exceeded",
      "This Google account has reached its yearly limit for new identities. Go back and create your account another way.",
    ],
  ] as const)("names the %s sign-up limit and offers no retry", (detailCode, nextStep) => {
    expect(
      googleIdentityErrorRecovery(
        { code: "homeserver_signup_token_failed", detailCode },
        { canReplaceFile: false },
      ),
    ).toEqual({ nextStep, retryHelps: false });
  });

  it("keeps the retry for a sign-up service that is not answering", () => {
    expect(
      googleIdentityErrorRecovery(
        { code: "homeserver_signup_token_failed", detailCode: "homegate_unavailable" },
        { canReplaceFile: false },
      ),
    ).toEqual({
      nextStep:
        "The sign-up service is not answering right now. Wait a few minutes, then try again.",
      retryHelps: true,
    });
  });

  it.each([
    "invalid_passport_file",
    "invalid_passport_file_delete_failed",
    "passport_file_undecryptable",
    "undecryptable_passport_file_delete_failed",
  ] as const)("resolves %s by deleting the file or another account, not a retry", (code) => {
    const withReplacement = googleIdentityErrorRecovery({ code }, replaceable);
    expect(withReplacement.retryHelps).toBe(false);
    expect(withReplacement.nextStep).toMatch(
      /^Delete the (damaged )?file and create a new pubky, or go back and choose another Google account\.$/u,
    );
    expect(googleIdentityErrorRecovery({ code }, { canReplaceFile: false })).toEqual({
      nextStep: "Go back and choose another Google account.",
      retryHelps: false,
    });
  });

  it("omits a next step the cause already gives", () => {
    expect(googleIdentityErrorMessage("homeserver_unreachable")).toMatch(/Try again later\.$/u);
    expect(googleIdentityErrorRecovery({ code: "homeserver_unreachable" }, replaceable)).toEqual({
      retryHelps: true,
    });
  });

  it("gives every other failure a retry with a way out if it keeps failing", () => {
    expect(googleIdentityErrorRecovery({ code: "restore_failed" }, replaceable)).toEqual({
      nextStep: "Try again. If it keeps failing, go back and choose another option.",
      retryHelps: true,
    });
  });
});
