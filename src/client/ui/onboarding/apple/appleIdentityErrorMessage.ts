import type { AppleIdentityViewError } from "@/client/logic/apple-identity/AppleIdentityController";

/**
 * Single mapping from an Apple identity view code to user-facing copy. The switch has no
 * default branch on purpose: a new code fails typechecking until it receives deliberate copy.
 */
function appleIdentityErrorMessage(code: AppleIdentityViewError["code"]): string {
  switch (code) {
    case "apple_sign_in_popup_blocked":
      return "Your browser blocked Apple's window. Allow popups for Passport and try again.";
    case "apple_sign_in_cancelled":
      return "The Apple window was closed before you signed in.";
    case "apple_sign_in_failed":
      return "Could not sign in with Apple. Try again.";
    case "apple_session_expired":
      return "Your Apple sign-in expired. Start again.";
    case "apple_account_mismatch":
      return "This is a different Apple Account than the one this identity uses.";
    case "icloud_unavailable":
      return "Apple could not prepare iCloud sign-in. Try again.";
    case "icloud_network_failed":
      return "Passport could not reach iCloud. Check your connection and try again.";
    case "icloud_sign_in_timeout":
      return "iCloud sign-in took too long. Try again when you are ready to finish in Apple’s window.";
    case "icloud_web_access_disabled":
      return "Web access to your iCloud data is turned off. In your device’s iCloud settings, open iCloud.com and turn on Allow Data Access (called Access iCloud Data on the Web on older devices).";
    case "icloud_popup_blocked":
      return "Your browser blocked the iCloud window. Allow popups for Passport and try again.";
    case "icloud_sign_in_cancelled":
      return "The iCloud window was closed before you signed in.";
    case "icloud_sign_in_failed":
      return "Apple could not complete iCloud sign-in. If you declined the iCloud terms, try again and accept them to continue.";
    case "icloud_account_mismatch":
      return "The Passport key in this iCloud belongs to a different Apple Account. Use the same Apple Account in both windows.";
    case "icloud_other_origin":
      return "The Passport key in this iCloud belongs to another Passport website and cannot be used here.";
    case "icloud_record_missing":
      return "This iCloud has no Passport key for this identity. Sign in to iCloud with the Apple Account you used when you set it up. To only remove the identity from this device, use Log out.";
    case "icloud_create_conflict":
      return "Another Passport key was saved to this iCloud at the same time. Try again.";
    case "icloud_quota_exceeded":
      return "Your iCloud storage is full. Free up space and try again.";
    case "icloud_read_failed":
      return "Passport could not read your encrypted identity from iCloud.";
    case "icloud_write_failed":
      return "Passport could not save your encrypted identity to iCloud.";
    case "icloud_cleanup_failed":
    case "local_remove_failed":
      return "Could not remove Apple access. Please try again.";
    case "invalid_passport_file":
      return "Passport found your encrypted identity in iCloud, but it is damaged and cannot be restored.";
    case "invalid_passport_file_delete_failed":
      return "Passport could not delete the damaged identity from iCloud. You can try deleting it again.";
    case "undecryptable_passport_file_delete_failed":
      return "Passport could not delete the identity it cannot decrypt from iCloud. You can try deleting it again.";
    case "create_failed":
      return "Passport could not create a new Pubky identity.";
    case "decrypt_failed":
      return "Passport found your encrypted identity, but could not decrypt it.";
    case "encrypt_failed":
      return "Passport created an identity, but could not encrypt it for iCloud.";
    case "identity_mismatch":
      return "The identity in iCloud does not match this Pubky.";
    case "provider_account_in_use":
      return "This Apple Account already holds another pubky. Passport keeps one pubky per account. Detach that pubky from Apple first, or use a different Apple Account.";
    case "identity_already_linked":
      return "In the meantime, this pubky was connected to another account. Go back to see which one.";
    case "identity_linked_meanwhile":
      return "Another tab connected an account at the same time. The backup is in iCloud, but this browser was not updated.";
    case "local_identity_unavailable":
      return "Passport could not read this pubky in this browser. Go back and check that it is still there.";
    case "local_link_failed":
      return "Your backup is in iCloud, but Passport could not update this browser. Try again.";
    case "homeserver_not_found":
      // Only a restore returns this (attach never does): the backup itself is fine.
      return "Passport could not find this pubky's homeserver record. Your backup in iCloud is unchanged. Open the app that manages this pubky so it republishes its homeserver, then try again.";
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
      return "Passport could not unlock your encrypted identity with this Apple Account.";
    case "homeserver_signup_token_failed":
      return "Passport could not obtain a homeserver invitation.";
    case "cancelled":
    case "operation_failed":
    case "unexpected_failure":
      return "Passport could not finish this operation. Please try again.";
  }
}

/** Names the Apple Account used in Apple's window, for failures about which account it was. */
function signedInAppleAccountNotice(appleEmail: string): string {
  return `You signed in with Apple as ${appleEmail}.`;
}

export { appleIdentityErrorMessage, signedInAppleAccountNotice };
