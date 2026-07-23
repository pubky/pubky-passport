import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { ValidatedSensitivePubkyAuthRequest } from "../../features/auth/parsePubkyAuthRequest";
import type { PubkyIdentityKeyHandle } from "../../features/identity/pubkyIdentity";
import type { ActiveLocalIdentityRestorer } from "../identity/localIdentityService";
import type { PubkyAuthApproval, PubkyIdentityKeys } from "../pubky/ports";

export type ActiveAuthorizationErrorCode =
  | "no_active_identity"
  | "identity_restore_failed"
  | "approval_failed";

export type ActiveAuthorizationResult = ResultType<void, { code: ActiveAuthorizationErrorCode }>;

export async function approveActiveAuthorization(input: {
  authRequest: ValidatedSensitivePubkyAuthRequest;
  localIdentities: ActiveLocalIdentityRestorer;
  pubky: PubkyIdentityKeys & PubkyAuthApproval;
}): Promise<ActiveAuthorizationResult> {
  let keyHandle: PubkyIdentityKeyHandle | undefined;

  try {
    const restored = await input.localIdentities.restoreActiveIdentity();
    if (Result.isError(restored)) {
      return Result.err({
        code: restored.error.code === "no_active_identity" ? "no_active_identity" : "identity_restore_failed",
      });
    }

    keyHandle = restored.value.keyHandle;
    const approved = await input.pubky.approveAuthRequest({
      keyHandle,
      authRequest: input.authRequest,
    });

    return Result.isError(approved) ? Result.err({ code: "approval_failed" }) : Result.ok();
  } catch {
    return Result.err({ code: keyHandle ? "approval_failed" : "identity_restore_failed" });
  } finally {
    if (keyHandle) {
      try {
        input.pubky.disposeIdentityKey({ keyHandle });
      } catch {
        // The operation still returns only its safe typed result after cleanup is attempted.
      }
    }
  }
}
