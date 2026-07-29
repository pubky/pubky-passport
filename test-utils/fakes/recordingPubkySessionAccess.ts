import { Result } from "better-result";

import type {
  PubkyIdentityKeyHandle,
} from "@/browser/pubky/application/pubkyIdentityKeys";
import type {
  PubkyIdentitySession,
  PubkySessionAccess,
  PubkySessionAccessErrorCode,
  PubkySessionAccessResult,
} from "@/browser/pubky/application/pubkySessionAccess";

export type RecordedPubkySessionSignupCall = {
  keyHandle: PubkyIdentityKeyHandle;
  homeserverPubky: string;
  hasSignupCode: boolean;
};

export type RecordedPubkySigninCall = {
  keyHandle: PubkyIdentityKeyHandle;
  waitForDiscovery: boolean;
};

export class RecordingPubkySessionAccess implements PubkySessionAccess {
  signupCalls: RecordedPubkySessionSignupCall[] = [];
  signinCalls: RecordedPubkySigninCall[] = [];

  signupFailure?: PubkySessionAccessErrorCode;
  signinFailure?: PubkySessionAccessErrorCode;

  session: PubkyIdentitySession = {
    publicIdentity: {
      publicKeyZ32: "fakepubkysession11111111111111111111111111111111111111111111",
      publicKeyDisplay: "pubkyfakepubkysession11111111111111111111111111111111111111111111",
    },
  };

  async signup(input: { keyHandle: PubkyIdentityKeyHandle; homeserverPubky: string; signupCode?: string | null }): Promise<PubkySessionAccessResult<PubkyIdentitySession>> {
    this.signupCalls.push({
      keyHandle: input.keyHandle,
      homeserverPubky: input.homeserverPubky,
      hasSignupCode: Boolean(input.signupCode),
    });

    if (this.signupFailure) {
      return failure(this.signupFailure);
    }

    return Result.ok(this.session);
  }

  async signin(input: { keyHandle: PubkyIdentityKeyHandle; waitForDiscovery?: boolean }): Promise<PubkySessionAccessResult<PubkyIdentitySession>> {
    this.signinCalls.push({
      keyHandle: input.keyHandle,
      waitForDiscovery: input.waitForDiscovery === true,
    });

    if (this.signinFailure) {
      return failure(this.signinFailure);
    }

    return Result.ok(this.session);
  }
}

function failure<T>(code: PubkySessionAccessErrorCode): PubkySessionAccessResult<T> {
  return Result.err({ code });
}
