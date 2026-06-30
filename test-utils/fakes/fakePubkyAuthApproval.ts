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
    this.calls.push({
      keyHandle: input.keyHandle,
      authRequestScheme: safeProtocol(input.authRequest.sensitivePubkyAuthUrl),
    });

    if (this.approvalFailure) {
      return { ok: false, error: { code: this.approvalFailure } };
    }

    return { ok: true };
  }
}

function safeProtocol(value: string): string | undefined {
  try {
    return new URL(value).protocol;
  } catch {
    return undefined;
  }
}
