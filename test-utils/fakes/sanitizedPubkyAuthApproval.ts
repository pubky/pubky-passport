import type { PubkyIdentityKeyHandle } from "@/browser/pubky/application/pubkyIdentityKeys";
import type { ValidatedSensitivePubkyAuthRequest } from "@/core/auth/parsePubkyAuthRequest";
import { Result } from "better-result";

import type {
  PubkyAuthApproval,
  PubkyAuthApprovalErrorCode,
  PubkyAuthApprovalResult,
} from "@/browser/pubky/application/pubkyAuthApproval";

export type SanitizedPubkyAuthApprovalCall = {
  keyHandle: PubkyIdentityKeyHandle;
  authRequestScheme?: string;
};

export class SanitizedPubkyAuthApproval implements PubkyAuthApproval {
  calls: SanitizedPubkyAuthApprovalCall[] = [];

  approvalFailure?: PubkyAuthApprovalErrorCode;

  async approveAuthRequest(input: { keyHandle: PubkyIdentityKeyHandle; authRequest: ValidatedSensitivePubkyAuthRequest }): Promise<PubkyAuthApprovalResult> {
    const authRequestScheme = safeProtocol(input.authRequest.sensitivePubkyAuthUrl);

    this.calls.push({
      keyHandle: input.keyHandle,
      ...(authRequestScheme ? { authRequestScheme } : {}),
    });

    if (this.approvalFailure) {
      return Result.err({ code: this.approvalFailure });
    }

    return Result.ok();
  }
}

function safeProtocol(value: string): string | undefined {
  try {
    return new URL(value).protocol;
  } catch {
    return undefined;
  }
}
