import "client-only";

import { Result, type Result as ResultType } from "better-result";

import type { ValidatedSensitivePubkyAuthRequest } from "../../../core/auth/parsePubkyAuthRequest";
import type {
  PubkyIdentityKey,
  PubkyIdentityKeyHandle,
  PubkyIdentityKeys,
} from "../../pubky/application/pubkyIdentityKeys";
import type { PubkyAuthApproval } from "../../pubky/application/pubkyAuthApproval";

export type ActiveAuthorizationErrorCode =
  | "no_active_identity"
  | "identity_restore_failed"
  | "approval_failed";

export type ActiveAuthorizationResult = ResultType<void, { code: ActiveAuthorizationErrorCode }>;

export type ActiveAuthorizationIdentityRestoreResult = ResultType<
  PubkyIdentityKey,
  { code: "no_active_identity" | "identity_restore_failed" }
>;

export type ActiveAuthorizationIdentityRestorer = {
  restoreActiveIdentity(): Promise<ActiveAuthorizationIdentityRestoreResult>;
};

export async function approveActiveAuthorization(input: {
  authRequest: ValidatedSensitivePubkyAuthRequest;
  localIdentities: ActiveAuthorizationIdentityRestorer;
  pubky: PubkyIdentityKeys & PubkyAuthApproval;
}): Promise<ActiveAuthorizationResult> {
  let keyHandle: PubkyIdentityKeyHandle | undefined;

  try {
    const restored = await input.localIdentities.restoreActiveIdentity();
    if (Result.isError(restored)) {
      return Result.err(restored.error);
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
