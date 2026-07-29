import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { ValidatedSensitivePubkyAuthRequest } from "../../../core/auth/parsePubkyAuthRequest";
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

    return Result.isError(approved) ? Result.err({ code: "approval_failed" }) : Result.ok();
  } catch {
    return Result.err({ code: keyHandle ? "approval_failed" : "identity_restore_failed" });
  } finally {
    if (keyHandle) {
      try {
        input.pubky.disposeIdentityKey(keyHandle);
      } catch {
        // The operation still returns only its safe typed result after cleanup is attempted.
      }
    }
  }
}
