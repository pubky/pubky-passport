import type { PubkyIdentityKeyHandle } from "@/features/identity/pubkyIdentity";
import type { ValidatedSensitivePubkyAuthRequest } from "@/features/auth/parsePubkyAuthRequest";
import { Result } from "better-result";

import type {
  PubkyAuthApproval,
  PubkyAuthApprovalErrorCode,
  PubkyAuthApprovalResult,
} from "@/browser/identity/dependencies/pubky";

export type FakePubkyAuthApprovalCall = {
  keyHandle: PubkyIdentityKeyHandle;
  authRequestScheme?: string;
};

export class FakePubkyAuthApproval implements PubkyAuthApproval {
  calls: FakePubkyAuthApprovalCall[] = [];

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
