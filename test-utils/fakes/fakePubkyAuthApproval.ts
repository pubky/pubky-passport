import type { PubkyIdentityKeyHandle } from "@/core/identity/pubkyIdentity";
import { Result } from "better-result";

import type {
  PubkyAuthApproval,
  PubkyAuthApprovalErrorCode,
  PubkyAuthApprovalResult,
} from "@/core/identity/dependencies/pubky";

export type FakePubkyAuthApprovalCall = {
  keyHandle: PubkyIdentityKeyHandle;
  authRequestScheme?: string;
};

export class FakePubkyAuthApproval implements PubkyAuthApproval {
  calls: FakePubkyAuthApprovalCall[] = [];

  approvalFailure?: PubkyAuthApprovalErrorCode;

  async approveAuthRequest(input: { keyHandle: PubkyIdentityKeyHandle; authRequest: { sensitivePubkyAuthUrl: string } }): Promise<PubkyAuthApprovalResult> {
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
