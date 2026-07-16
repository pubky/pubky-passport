import type { PubkyIdentityKeyHandle } from "@/core/domain/identity/pubkyIdentity";
import type {
  ApprovePubkyAuthRequestInput,
  PubkyAuthApproval,
  PubkyAuthApprovalErrorCode,
  PubkyAuthApprovalResult,
} from "@/core/ports/pubkyAuthApproval";

export type FakePubkyAuthApprovalCall = {
  keyHandle: PubkyIdentityKeyHandle;
  authRequestScheme?: string;
};

export class FakePubkyAuthApproval implements PubkyAuthApproval {
  calls: FakePubkyAuthApprovalCall[] = [];

  approvalFailure?: PubkyAuthApprovalErrorCode;

  async approveAuthRequest(input: ApprovePubkyAuthRequestInput): Promise<PubkyAuthApprovalResult> {
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
import { Result } from "better-result";
