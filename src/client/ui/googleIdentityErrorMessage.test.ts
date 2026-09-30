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
  create_failed: "Passport couldn’t create a new identity.",
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
  google_account_mismatch:
    "You chose a different Google account than the one you started with. Try again and choose the same account.",
  google_authorization_denied: "Passport needs access to your Google Drive to continue.",
  google_drive_access_required:
    "Passport needs permission to store its encrypted identity in Google Drive. Select the configuration-data checkbox and try again.",
  google_authorization_failed: "Could not connect to Google. Try again.",
  google_authorization_popup_closed:
    "You closed Google’s window before finishing. Nothing was created or changed.",
  google_authorization_popup_failed_to_open:
    "Passport could not open the Google authorization window. Check your popup settings and try again.",
  google_drive_cleanup_failed:
    "Passport couldn’t finish deleting the backup from Google Drive, so Google access was not removed. Try again.",
  google_detachment_permission_required:
    "Passport needs both Google Drive permissions to delete your encrypted backup and its copy in your “Pubky Passport” folder before removing Google access.",
  homeserver_signup_token_failed:
    "Passport couldn’t get an invitation to create your pubky, so nothing was created.",
  homeserver_unreachable:
    "The homeserver isn’t answering right now, so Passport stopped before setting up your pubky. Try again later.",
  homeserver_invite_rejected:
    "The homeserver did not accept the invitation Passport received for your new identity, so nothing was saved to Google Drive. The operator of this Passport may need to check its invitations.",
  identity_mismatch:
    "Passport signed in as a different pubky than the one in your Google Drive backup, so it stopped.",
  invalid_passport_file:
    "Passport found a backup in your Google Drive, but it’s damaged and can’t be restored.",
  passport_file_undecryptable:
    "Passport found a backup in your Google Drive, but can no longer unlock it with this Google account.",
  foreign_passport_file:
    "This Google account already has a Passport identity file that names another Passport site. This Passport cannot unlock it and has not changed it.",
  invalid_passport_file_delete_failed:
    "Passport couldn’t delete the damaged backup from Google Drive, so no new pubky was created.",
  undecryptable_passport_file_delete_failed:
    "Passport couldn’t delete the backup it can no longer unlock from Google Drive, so no new pubky was created.",
  local_identity_held_by_ring:
    "This pubky is connected through Pubky Ring in this browser, so Passport left it there and did not save the key from your Google Drive backup. To keep the key in this browser instead, remove the Pubky Ring entry, then continue with Google again.",
  local_identity_unavailable:
    "Passport could not read this identity from this browser, so nothing was removed from Google Drive. Reload the page and try again.",
  local_identity_not_bound:
    "This identity is no longer stored in this browser with this Google account, so nothing was removed from Google Drive. Reload the page and try again.",
  local_save_failed:
    "Your pubky is set up and backed up to Google Drive, but this browser didn’t let Passport save it (storage may be full or blocked).",
  local_unlink_failed:
    "Your Google Drive backup was removed, but Passport could not update this browser. Try again to finish removing Google access.",
  operation_failed: "Passport could not finish this operation. Please try again.",
  publication_failed: "Passport couldn’t publish your pubky, so apps can’t find it yet.",
  restore_failed: "Passport couldn’t restore the identity from your Google Drive backup.",
  signin_failed:
    "Your pubky is saved, encrypted, in your Google Drive, but Passport couldn’t sign in to its homeserver.",
  signup_failed:
    "Your pubky is saved, encrypted, in your Google Drive, but its homeserver didn’t finish setting it up. Try again and Passport will finish setting up the same pubky.",
  unexpected_failure: "Passport could not finish this operation. Please try again.",
  wrapping_key_failed:
    "Passport could not unlock your encrypted identity with this Google account.",
  visible_backup_permission_missing:
    "Passport can continue, but it won’t put a copy of your backup in a “Pubky Passport” folder in your Google Drive unless you tick the second box.",
};

type ViewError = Pick<GoogleIdentityViewError, "code" | "detailCode" | "flow">;

const CHECK_UNAVAILABLE =
  "Passport can’t check your Google sign-in right now, so it couldn’t restore or create your pubky.";
const SIGNUP_SERVICE_DOWN =
  "The sign-up service isn’t answering right now, so nothing was created.";

/** Failures whose copy depends on the detail code, each with what it must say. */
const DETAILED_COPY: [ViewError, string][] = [
  [
    { code: "wrapping_key_failed", detailCode: "invalid_google_id_token" },
    "Your Google sign-in expired before Passport could restore or create your pubky.",
  ],
  [{ code: "wrapping_key_failed", detailCode: "google_verifier_unavailable" }, CHECK_UNAVAILABLE],
  [{ code: "wrapping_key_failed", detailCode: "network_failed" }, CHECK_UNAVAILABLE],
  [{ code: "wrapping_key_failed", detailCode: "internal_error" }, CHECK_UNAVAILABLE],
  [{ code: "wrapping_key_failed", detailCode: "key_derivation_failed" }, CHECK_UNAVAILABLE],
  [{ code: "wrapping_key_failed", detailCode: "invalid_response" }, CHECK_UNAVAILABLE],
  [
    { code: "wrapping_key_failed", detailCode: "key_unavailable" },
    "Passport could not unlock your encrypted identity with this Google account.",
  ],
  [
    { code: "homeserver_signup_token_failed", detailCode: "weekly_limit_exceeded" },
    "This Google account has reached its weekly limit for new pubkys, so nothing was created.",
  ],
  [
    { code: "homeserver_signup_token_failed", detailCode: "annual_limit_exceeded" },
    "This Google account has reached its yearly limit for new pubkys, so nothing was created.",
  ],
  [
    { code: "homeserver_signup_token_failed", detailCode: "blocked" },
    "New Google sign-ups aren’t available in your country, so nothing was created.",
  ],
  [
    { code: "homeserver_signup_token_failed", detailCode: "homeserver_unavailable" },
    SIGNUP_SERVICE_DOWN,
  ],
  [
    { code: "homeserver_signup_token_failed", detailCode: "homegate_unavailable" },
    SIGNUP_SERVICE_DOWN,
  ],
  [
    { code: "homeserver_signup_token_failed", detailCode: "google_verifier_unavailable" },
    SIGNUP_SERVICE_DOWN,
  ],
  [{ code: "homeserver_signup_token_failed", detailCode: "network_failed" }, SIGNUP_SERVICE_DOWN],
  [
    { code: "homeserver_signup_token_failed", detailCode: "invalid_google_id_token" },
    "Your Google sign-in expired before Passport could finish, so nothing was created.",
  ],
  [
    { code: "homeserver_signup_token_failed", detailCode: "malformed_homegate_response" },
    "Passport couldn’t get an invitation to create your pubky, so nothing was created.",
  ],
  [
    { code: "homeserver_signup_token_failed", detailCode: "invalid_homegate_homeserver" },
    "The sign-up service didn’t say which homeserver your pubky belongs on, so nothing was created.",
  ],
  [
    { code: "homeserver_signup_token_failed", detailCode: "blocked", flow: "create" },
    "New Google sign-ups aren’t available in your country, so nothing was created.",
  ],
];

/**
 * A pubky restored from Drive without a homeserver asks for the same invitation. It exists, so its
 * copy says it is safe instead of "nothing was created", and never suggests creating another.
 */
const REPAIR_COPY: [ViewError, string][] = [
  [
    { code: "homeserver_signup_token_failed", detailCode: "weekly_limit_exceeded", flow: "repair" },
    "Your pubky is safe in your Google Drive, but Passport can’t finish setting it up with its server: this Google account has reached its weekly sign-up limit. Nothing was lost.",
  ],
  [
    { code: "homeserver_signup_token_failed", detailCode: "annual_limit_exceeded", flow: "repair" },
    "Your pubky is safe in your Google Drive, but Passport can’t finish setting it up with its server: this Google account has reached its yearly sign-up limit. Nothing was lost.",
  ],
  [
    { code: "homeserver_signup_token_failed", detailCode: "blocked", flow: "repair" },
    "Your pubky is safe in your Google Drive, but Passport can’t finish setting it up with its server: new Google sign-ups aren’t available in your country. Nothing was lost.",
  ],
  [
    { code: "homeserver_signup_token_failed", detailCode: "homegate_unavailable", flow: "repair" },
    "Your pubky is safe in your Google Drive, but Passport can’t finish setting it up while the sign-up service isn’t answering. Nothing was lost.",
  ],
  [
    {
      code: "homeserver_signup_token_failed",
      detailCode: "invalid_google_id_token",
      flow: "repair",
    },
    "Your Google sign-in expired before Passport could finish setting up your pubky. It’s safe in your Google Drive.",
  ],
  [
    {
      code: "homeserver_signup_token_failed",
      detailCode: "invalid_homegate_homeserver",
      flow: "repair",
    },
    "Your pubky is safe in your Google Drive, but Passport can’t finish setting it up with its server: the sign-up service didn’t say which homeserver it belongs on. Nothing was lost.",
  ],
  [
    {
      code: "homeserver_signup_token_failed",
      detailCode: "malformed_homegate_response",
      flow: "repair",
    },
    "Your pubky is safe in your Google Drive, but Passport can’t finish setting it up with its server right now. Nothing was lost.",
  ],
];

describe("googleIdentityErrorMessage", () => {
  it.each(Object.entries(EXPECTED_COPY) as [GoogleIdentityViewError["code"], string][])(
    "maps %s to its user copy",
    (code, copy) => {
      const message = googleIdentityErrorMessage({ code });

      expect(message).toBe(copy);
      expect(message).not.toContain("_");
      expect(message.endsWith(".")).toBe(true);
    },
  );

  // A new pubky's failures must not read as a found or locked identity.
  it.each(DETAILED_COPY)("says what happened for %o", (error, copy) => {
    expect(googleIdentityErrorMessage(error)).toBe(copy);
  });

  it.each(REPAIR_COPY)("keeps a restored pubky safe for %o", (error, copy) => {
    const message = googleIdentityErrorMessage(error);

    expect(message).toBe(copy);
    expect(message).not.toMatch(/nothing was created/iu);
  });

  // Replacing a damaged or unreadable backup deletes it before the wrapping key is asked for, so
  // a wrapping-key failure there follows a deletion and must not claim nothing changed.
  it.each([
    "invalid_google_id_token",
    "google_verifier_unavailable",
    "network_failed",
    "internal_error",
    "key_derivation_failed",
    "invalid_response",
  ] as const)(
    "does not claim nothing changed for %s after a replacement deleted the backup",
    (detailCode) => {
      const failure = { code: "wrapping_key_failed", detailCode } as const;

      expect(googleIdentityErrorMessage(failure)).not.toMatch(/nothing was changed/iu);
      expect(googleIdentityErrorMessage(failure)).toMatch(/restore or create your pubky/u);
    },
  );

  // Every code the attach (backup) operation can fail with, including authorization failures,
  // mapped to copy that describes attaching rather than restoring or detaching.
  it.each([
    [
      "google_account_mismatch",
      "This pubky is already backed up to a different Google account. Try again and choose that account in Google’s window.",
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
    expect(googleIdentityErrorMessage({ code }, { operation: "attach" })).toBe(copy);
  });

  it("names the Google account whose backup a detachment removes", () => {
    const detach = { operation: "detach", email: "alex@example.com" } as const;

    // A wrong account is not reported as a connection problem.
    expect(googleIdentityErrorMessage({ code: "google_account_mismatch" }, detach)).toBe(
      "You chose a different Google account. To remove this backup, choose alex@example.com in Google’s window.",
    );
    expect(googleIdentityErrorMessage({ code: "google_drive_cleanup_failed" }, detach)).toBe(
      "Passport couldn’t finish deleting the backup from Google Drive. This pubky is still attached to alex@example.com. Try again.",
    );
    expect(googleIdentityErrorMessage({ code: "authorization_failed" }, detach)).toBe(
      EXPECTED_COPY.authorization_failed,
    );
  });

  it("keeps the default copy outside the attach and detach screens", () => {
    expect(
      googleIdentityErrorMessage({ code: "google_account_mismatch" }, { operation: "establish" }),
    ).toBe(EXPECTED_COPY.google_account_mismatch);
    expect(googleIdentityErrorMessage({ code: "wrapping_key_failed" })).toBe(
      EXPECTED_COPY.wrapping_key_failed,
    );
  });
});

describe("googleIdentityErrorRecovery", () => {
  const replaceable = { canReplaceFile: true };

  // A refused new pubky leaves nothing to restore with this account, but the other ways in work.
  it.each([
    [
      "weekly_limit_exceeded",
      "There’s no Passport backup to restore in this Google account. Try again next week, or go back to create an account or sign in with Pubky Ring.",
    ],
    [
      "annual_limit_exceeded",
      "There’s no Passport backup to restore in this Google account. Go back to create an account or sign in with Pubky Ring.",
    ],
    [
      "blocked",
      "There’s no Passport backup to restore in this Google account. Go back to create an account or sign in with Pubky Ring.",
    ],
  ] as const)("offers no retry for the %s sign-up refusal", (detailCode, nextStep) => {
    expect(
      googleIdentityErrorRecovery(
        { code: "homeserver_signup_token_failed", detailCode, flow: "create" },
        { canReplaceFile: false },
      ),
    ).toEqual({ nextStep, retryHelps: false });
  });

  // The pubky exists in Drive: no advice to create another one, and no retry that can't help.
  it.each([
    ["weekly_limit_exceeded", { nextStep: "Try again next week.", retryHelps: false }],
    [
      "annual_limit_exceeded",
      { nextStep: "Try again once the yearly limit resets.", retryHelps: false },
    ],
    ["blocked", { retryHelps: false }],
    ["network_failed", { nextStep: "Wait a few minutes, then try again.", retryHelps: true }],
  ] as const)("finishes a restored pubky later after the %s refusal", (detailCode, recovery) => {
    expect(
      googleIdentityErrorRecovery(
        { code: "homeserver_signup_token_failed", detailCode, flow: "repair" },
        { canReplaceFile: false },
      ),
    ).toEqual(recovery);
  });

  it("keeps the retry for a sign-up service that is not answering", () => {
    expect(
      googleIdentityErrorRecovery(
        { code: "homeserver_signup_token_failed", detailCode: "homegate_unavailable" },
        { canReplaceFile: false },
      ),
    ).toEqual({ nextStep: "Wait a few minutes, then try again.", retryHelps: true });
  });

  it("asks for a fresh sign-in after an expired one, and patience when the check is down", () => {
    expect(
      googleIdentityErrorRecovery(
        { code: "wrapping_key_failed", detailCode: "invalid_google_id_token" },
        replaceable,
      ),
    ).toEqual({ nextStep: "Try again and sign in once more.", retryHelps: true });
    expect(
      googleIdentityErrorRecovery(
        { code: "wrapping_key_failed", detailCode: "google_verifier_unavailable" },
        replaceable,
      ),
    ).toEqual({
      nextStep: "Check your connection, then try again in a few minutes.",
      retryHelps: true,
    });
  });

  it.each(["invalid_passport_file", "passport_file_undecryptable"] as const)(
    "resolves %s by deleting the backup or another account, not a retry",
    (code) => {
      expect(googleIdentityErrorRecovery({ code }, replaceable)).toEqual({
        nextStep:
          "Delete this backup and start over with a new pubky, or go back and choose another Google account.",
        retryHelps: false,
      });
      expect(googleIdentityErrorRecovery({ code }, { canReplaceFile: false })).toEqual({
        nextStep: "Go back and choose another Google account.",
        retryHelps: false,
      });
    },
  );

  it.each([
    "invalid_passport_file_delete_failed",
    "undecryptable_passport_file_delete_failed",
  ] as const)("resolves %s by deleting again, since signing in again finds the file", (code) => {
    expect(googleIdentityErrorRecovery({ code }, replaceable)).toEqual({
      nextStep: "Try deleting it again, or go back and choose another Google account.",
      retryHelps: false,
    });
  });

  it.each(["homeserver_unreachable", "signup_failed", "google_account_mismatch"] as const)(
    "omits a next step the cause of %s already gives",
    (code) => {
      expect(googleIdentityErrorMessage({ code })).toMatch(/Try again/u);
      expect(googleIdentityErrorRecovery({ code }, replaceable)).toEqual({ retryHelps: true });
    },
  );

  it("gives every other failure a retry with a way out if it keeps failing", () => {
    expect(googleIdentityErrorRecovery({ code: "restore_failed" }, replaceable)).toEqual({
      nextStep: "Try again. If it keeps failing, go back and choose another option.",
      retryHelps: true,
    });
  });
});
