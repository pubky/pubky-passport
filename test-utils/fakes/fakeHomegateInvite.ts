import { Result } from "better-result";

import type {
  GoogleHomegateInviteErrorCode,
  GoogleHomegateInviteResult,
  HomeserverSignupInvitation,
  GoogleHomegateInviteClient,
} from "@/server/homegate/dependencies";

export type FakeHomegateInviteCall = {
  hasGoogleIdToken: boolean;
};

export class FakeHomegateInvite implements GoogleHomegateInviteClient {
  calls: FakeHomegateInviteCall[] = [];
  failure?: GoogleHomegateInviteErrorCode;

  invite: HomeserverSignupInvitation = {
    signupCode: "fake-signup-code",
    homeserverPubky: "fakehomeserver11111111111111111111111111111111111111111111",
  };

  async requestInvite(input: { googleIdToken: string }): Promise<GoogleHomegateInviteResult> {
    this.calls.push({
      hasGoogleIdToken: input.googleIdToken.trim().length > 0,
    });

    if (this.failure) {
      return Result.err({ code: this.failure });
    }

    return Result.ok(this.invite);
  }
}
