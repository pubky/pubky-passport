import { Result } from "better-result";

import type {
  GoogleHomegateInviteErrorCode,
  GoogleHomegateInvitePort,
  GoogleHomegateInviteRequest,
  GoogleHomegateInviteResult,
  HomeserverSignupInvitation,
} from "@/core/ports/homegateInvite";

export type FakeHomegateInviteCall = {
  hasGoogleIdToken: boolean;
};

export class FakeHomegateInvite implements GoogleHomegateInvitePort {
  calls: FakeHomegateInviteCall[] = [];
  failure?: GoogleHomegateInviteErrorCode;

  invite: HomeserverSignupInvitation = {
    signupCode: "fake-signup-code",
    homeserverPubky: "fakehomeserver11111111111111111111111111111111111111111111",
  };

  async requestInvite(input: GoogleHomegateInviteRequest): Promise<GoogleHomegateInviteResult> {
    this.calls.push({
      hasGoogleIdToken: input.googleIdToken.trim().length > 0,
    });

    if (this.failure) {
      return Result.err({ code: this.failure });
    }

    return Result.ok(this.invite);
  }
}
