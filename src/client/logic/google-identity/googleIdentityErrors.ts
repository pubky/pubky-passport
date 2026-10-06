import type { CodedFailure } from "@/libs/result";
import type { HomegateSignupTokenErrorCode } from "@/client/logic/homegate/HomegateClient";
import type { GoogleWrappingKeyErrorCode } from "@/client/logic/wrapping-key/GoogleWrappingKeyApiClient";
import type { GoogleImplicitAuthorizationError } from "./gia/GoogleImplicitAuthorization";

/** Why Passport asked Homegate for a signup invitation. */
export type SignupInvitationFlow = "create" | "repair";

/** Failure produced by the lifecycle layer, before the controller strips diagnostics. */
export type GoogleIdentityLifecycleError =
  | {
      code: "wrapping_key_failed";
      detailCode: GoogleWrappingKeyErrorCode;
      cause?: unknown;
    }
  | {
      /** A Passport file written by another Passport origin that this origin cannot unlock. */
      code: "foreign_passport_file";
      passportFileOrigin: string;
      cause?: unknown;
    }
  | {
      code: "homeserver_signup_token_failed";
      detailCode: HomegateSignupTokenErrorCode;
      /**
       * `create` asked for a new pubky's invitation, before anything was written. `repair` asked for
       * one to finish setting up a pubky restored from Drive whose homeserver signup never
       * completed, so that pubky exists and stays in Drive.
       */
      flow: SignupInvitationFlow;
      cause?: unknown;
    }
  | CodedFailure<
      | "create_failed"
      | "decrypt_failed"
      | "publication_failed"
      | "drive_create_conflict"
      | "google_backup_conflict"
      | "google_backup_created_not_linked"
      | "invalid_passport_file"
      | "invalid_passport_file_delete_failed"
      | "undecryptable_passport_file_delete_failed"
      | "passport_file_undecryptable"
      | "drive_read_failed"
      | "drive_write_failed"
      | "encrypt_failed"
      | "identity_mismatch"
      | "local_identity_not_bound"
      | "local_identity_unavailable"
      | "local_save_failed"
      /**
       * The restored pubky is saved in this browser as held by Pubky Ring; its key from Drive was
       * not written over that entry.
       */
      | "local_identity_held_by_ring"
      | "local_unlink_failed"
      | "restore_failed"
      | "signin_failed"
      | "signup_failed"
      | "unexpected_failure"
      | "google_account_mismatch"
      | "google_drive_cleanup_failed"
      | "google_detachment_permission_required"
      /**
       * The homeserver did not answer before any Drive file or record was written; the invite is
       * kept for the next attempt on this page.
       */
      | "homeserver_unreachable"
      /** The homeserver reported Homegate's invite used or unknown; nothing was written. */
      | "homeserver_invite_rejected"
      | "visible_backup_permission_missing"
    >;

/** Internal Google identity failure, including diagnostic `cause` before the UI boundary. */
export type GoogleIdentityError =
  | GoogleIdentityLifecycleError
  | GoogleImplicitAuthorizationError
  | CodedFailure<"authorization_failed" | "cancelled" | "operation_failed">;

type GoogleIdentityErrorDetailCode = Extract<
  GoogleIdentityError,
  { detailCode: string }
>["detailCode"];

/** Error fields explicitly allowed to cross into React state or rendered output. */
export type GoogleIdentityViewError = {
  code: GoogleIdentityError["code"];
  detailCode?: GoogleIdentityErrorDetailCode;
  /** Normalized origin of the Passport that wrote a foreign Drive file. */
  passportFileOrigin?: string;
  /** For a signup invitation failure, whether a pubky already existed (see the lifecycle error). */
  flow?: SignupInvitationFlow;
};

/**
 * Drops `cause` and other diagnostic fields. Keeps `code`, `detailCode`, `passportFileOrigin`, and
 * a signup invitation's `flow`.
 */
export function withoutCause(error: GoogleIdentityError): GoogleIdentityViewError {
  if (error.code === "homeserver_signup_token_failed") {
    return { code: error.code, detailCode: error.detailCode, flow: error.flow };
  }
  if ("detailCode" in error) return { code: error.code, detailCode: error.detailCode };
  if ("passportFileOrigin" in error) {
    return { code: error.code, passportFileOrigin: error.passportFileOrigin };
  }
  return { code: error.code };
}
