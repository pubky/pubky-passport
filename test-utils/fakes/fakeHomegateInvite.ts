import type {
  GoogleHomegateInvite,
  HomegateInviteErrorCode,
  HomegateInvitePort,
  HomegateInviteResult,
  RequestGoogleHomegateInviteInput,
} from "@/core/ports/homegateInvite";

export type FakeHomegateInviteCall = {
  hasGoogleIdToken: boolean;
};

export class FakeHomegateInvite implements HomegateInvitePort {
  calls: FakeHomegateInviteCall[] = [];
  failure?: HomegateInviteErrorCode;

  invite: GoogleHomegateInvite = {
    signupCode: "fake-signup-code",
    homeserverPubky: "fakehomeserver11111111111111111111111111111111111111111111",
  };

  async requestGoogleInvite(input: RequestGoogleHomegateInviteInput): Promise<HomegateInviteResult> {
    this.calls.push({
      hasGoogleIdToken: input.googleIdToken.trim().length > 0,
    });

    if (this.failure) {
      return { ok: false, error: { code: this.failure } };
    }

    return { ok: true, value: this.invite };
  }
}
