import type { Result } from "better-result";

import type {
  PubkyIdentityKeyHandle,
  ValidatedSensitivePubkyAuthRequest,
} from "../domain/identity/pubkyIdentity";

export type PubkyAuthApprovalErrorCode =
  | "approval_failed"
  | "key_unavailable"
  | "relay_failed"
  | "request_rejected";

export type PubkyAuthApprovalError = {
  code: PubkyAuthApprovalErrorCode;
};

export type PubkyAuthApprovalResult = Result<void, PubkyAuthApprovalError>;

export type ApprovePubkyAuthRequestInput = {
  keyHandle: PubkyIdentityKeyHandle;
  authRequest: ValidatedSensitivePubkyAuthRequest;
};

export interface PubkyAuthApproval {
  approveAuthRequest(input: ApprovePubkyAuthRequestInput): Promise<PubkyAuthApprovalResult>;
}
