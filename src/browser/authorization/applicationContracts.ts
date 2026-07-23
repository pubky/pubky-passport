import "client-only";

import type { Result } from "better-result";

import type { ValidatedSensitivePubkyAuthRequest } from "../../features/auth/parsePubkyAuthRequest";
import type { PubkyIdentityKeyHandle } from "../../features/identity/pubkyIdentity";

export type PubkyAuthApprovalErrorCode = "approval_failed" | "key_unavailable" | "relay_failed" | "request_rejected";
export type PubkyAuthApprovalResult = Result<void, { code: PubkyAuthApprovalErrorCode }>;

export type PubkyAuthApproval = {
  approveAuthRequest(input: {
    keyHandle: PubkyIdentityKeyHandle;
    authRequest: ValidatedSensitivePubkyAuthRequest;
  }): Promise<PubkyAuthApprovalResult>;
};
