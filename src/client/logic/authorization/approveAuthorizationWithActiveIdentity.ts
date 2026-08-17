import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import { RestoreActiveLocalIdentityKey } from "../identity/local/restoreActiveLocalIdentityKey";
import type { PubkyIdentityKey } from "../pubky/pubkyIdentityKey";
import { PubkySdkAdapter } from "../pubky/pubkySdkAdapter";
import type { PubkyAuthApprovalCapability } from "./browserAuthorizationRequest";

export type ApproveAuthorizationErrorCode =
  | "no_active_identity"
  | "identity_restore_failed"
  | "approval_failed";

export type ApproveAuthorizationResult = ResultType<void, { code: ApproveAuthorizationErrorCode }>;

/**
 * Restores the active local key, approves one validated request with the same
 * Pubky adapter, and always disposes the restored key handle.
 */
export async function approveAuthorizationWithActiveIdentity(
  approval: PubkyAuthApprovalCapability,
  restoreActiveIdentity: RestoreActiveLocalIdentityKey,
  pubky: PubkySdkAdapter,
): Promise<ApproveAuthorizationResult> {
  let keyHandle: PubkyIdentityKey["keyHandle"] | undefined;

  try {
    const restored = await restoreActiveIdentity.restore();
    if (Result.isError(restored)) {
      return Result.err({
        code: restored.error.code === "no_active_identity"
          ? "no_active_identity"
          : "identity_restore_failed",
      });
    }

    keyHandle = restored.value.keyHandle;
    const approved = await pubky.approveAuthRequest(keyHandle, approval);

    if (Result.isError(approved)) return Result.err({ code: "approval_failed" });
    return Result.ok();
  } catch {
    LOGGER.warn("authorize.approval.failed", {
      stage: keyHandle ? "sdk_approve" : "identity_restore",
      code: "unexpected_failure",
    });
    return Result.err({ code: keyHandle ? "approval_failed" : "identity_restore_failed" });
  } finally {
    if (keyHandle) {
      try {
        pubky.disposeIdentityKey(keyHandle);
      } catch {
        LOGGER.warn("authorize.cleanup.failed", { operation: "identity_key_dispose" });
      }
    }
  }
}
