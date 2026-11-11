import type { CodedFailure } from "@/libs/result";
import type { IdentityLifecycleError } from "@/client/logic/identity-lifecycle/PassportFileIdentityLifecycle";
import type { GoogleImplicitAuthorizationError } from "./gia/GoogleImplicitAuthorization";

/** Failure produced by the lifecycle layer, before the controller strips diagnostics. */
export type GoogleIdentityLifecycleError =
  | IdentityLifecycleError
  | CodedFailure<
      | "drive_create_conflict"
      | "invalid_passport_file"
      | "invalid_passport_file_delete_failed"
      | "undecryptable_passport_file_delete_failed"
      | "drive_read_failed"
      | "drive_write_failed"
      | "google_account_mismatch"
      | "google_drive_cleanup_failed"
      | "google_detachment_permission_required"
      | "visible_backup_permission_missing"
      | "local_remove_failed"
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
};

/** Drops `cause` and other diagnostic fields. Keeps `code` and `detailCode` unchanged. */
export function withoutCause(error: GoogleIdentityError): GoogleIdentityViewError {
  return "detailCode" in error
    ? { code: error.code, detailCode: error.detailCode }
    : { code: error.code };
}
