import "client-only";

import type { Result } from "better-result";

export type PubkyAuthApprovalErrorCode = "approval_failed" | "key_unavailable" | "relay_failed" | "request_rejected";
export type PubkyAuthApprovalResult = Result<void, { code: PubkyAuthApprovalErrorCode }>;
