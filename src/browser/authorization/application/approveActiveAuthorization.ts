import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { ValidatedSensitivePubkyAuthRequest } from "../../../core/auth/parsePubkyAuthRequest";
import { LOGGER } from "../../../libs/logger/logger";
import type {
  PubkyIdentityKey,
} from "../../pubky/application/pubkyIdentityKey";
import { PubkySdkAdapter } from "../../pubky/adapters/pubkySdkAdapter";

export type ActiveAuthorizationErrorCode =
  | "no_active_identity"
  | "identity_restore_failed"
  | "approval_failed";

export type ActiveAuthorizationResult = ResultType<void, { code: ActiveAuthorizationErrorCode }>;

export type ActiveAuthorizationIdentityRestoreResult = ResultType<
  PubkyIdentityKey,
  { code: "no_active_identity" | "identity_restore_failed" }
>;

export async function approveActiveAuthorization(input: {
  authRequest: ValidatedSensitivePubkyAuthRequest;
  restoreActiveIdentity: () => Promise<ActiveAuthorizationIdentityRestoreResult>;
  pubky: PubkySdkAdapter;
}): Promise<ActiveAuthorizationResult> {
  let keyHandle: PubkyIdentityKey["keyHandle"] | undefined;

  try {
    const restored = await input.restoreActiveIdentity();
    if (Result.isError(restored)) {
      return Result.err(restored.error);
    }

    keyHandle = restored.value.keyHandle;
    const approved = await input.pubky.approveAuthRequest(keyHandle, input.authRequest);

    if (Result.isError(approved)) {
      LOGGER.warn("authorize.approval.failed", {
        stage: "sdk_approve",
        code: approved.error.code,
      });
      return Result.err({ code: "approval_failed" });
    }
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
        input.pubky.disposeIdentityKey(keyHandle);
      } catch {
        LOGGER.warn("authorize.cleanup.failed", { operation: "identity_key_dispose" });
      }
    }
  }
}
