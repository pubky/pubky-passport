import type { CodedFailure } from "@/libs/result";
import type { LocalIdentityErrorCode } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import type { PubkyAuthApprovalErrorCode } from "@/client/logic/pubky/PubkySdkAdapter";
import type { OpenerApprovalFailureReason } from "../opener/OpenerChannel";

export type ApprovalFailureReason = OpenerApprovalFailureReason;
export type RestoreLocalIdentityErrorCode =
  LocalIdentityErrorCode | "identity_mismatch" | "restore_failed";

/** Reduces an internal failure to a stable, non-sensitive outcome code. */
export function approvalFailureReason(
  ...[stage, failure]:
    | [stage: "identity_restore", failure: CodedFailure<RestoreLocalIdentityErrorCode>]
    | [stage: "sdk_approve", failure: CodedFailure<PubkyAuthApprovalErrorCode>]
): ApprovalFailureReason {
  if (stage === "identity_restore") {
    switch (failure.code) {
      case "storage_unavailable":
        return "storage_unavailable";
      case "invalid_identity":
      case "invalid_secret_key":
      case "invalid_store":
      case "identity_mismatch":
      case "restore_failed":
      case "external_key":
        return "identity_unavailable";
      default:
        failure.code satisfies never;
    }
  }
  if (stage === "sdk_approve") {
    switch (failure.code) {
      case "key_unavailable":
        return "identity_unavailable";
      case "request_rejected":
        return "approval_failed";
      case "approval_failed":
        return sdkApprovalFailureReason(failure);
      default:
        failure.code satisfies never;
    }
  }
  return "approval_failed";
}

function sdkApprovalFailureReason(
  failure: CodedFailure<PubkyAuthApprovalErrorCode>,
): ApprovalFailureReason {
  try {
    const cause = failure.cause;
    if (
      typeof cause === "object" &&
      cause !== null &&
      "name" in cause &&
      cause.name === "RequestError"
    )
      return "relay_unreachable";
  } catch {
    // SDK errors can have throwing accessors; no arbitrary name or message crosses this boundary.
  }
  return "approval_failed";
}
