import type {
  PubkyIdentityKeyHandle,
  PubkyIdentitySession,
} from "@/core/domain/identity/pubkyIdentity";
import type {
  PubkySignup,
  PubkySignupErrorCode,
  PubkySignupResult,
  SigninWithPubkyInput,
  SignupWithPubkyInput,
} from "@/core/ports/pubkySignup";

export type FakePubkySignupCall = {
  keyHandle: PubkyIdentityKeyHandle;
  homeserverPubky: string;
  hasSignupCode: boolean;
};

export type FakePubkySigninCall = {
  keyHandle: PubkyIdentityKeyHandle;
  waitForDiscovery: boolean;
};

export class FakePubkySignup implements PubkySignup {
  signupCalls: FakePubkySignupCall[] = [];
  signinCalls: FakePubkySigninCall[] = [];

  signupFailure?: PubkySignupErrorCode;
  signinFailure?: PubkySignupErrorCode;

  session: PubkyIdentitySession = {
    publicIdentity: {
      publicKeyZ32: "fakepubkysession11111111111111111111111111111111111111111111",
      publicKeyDisplay: "pubkyfakepubkysession11111111111111111111111111111111111111111111",
    },
    capabilities: ["/pub/pubky.app/:rw"],
    sessionSnapshot: "fake-session-snapshot",
  };

  async signup(input: SignupWithPubkyInput): Promise<PubkySignupResult<PubkyIdentitySession>> {
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

  async signin(input: SigninWithPubkyInput): Promise<PubkySignupResult<PubkyIdentitySession>> {
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

function failure<T>(code: PubkySignupErrorCode): PubkySignupResult<T> {
  return Result.err({ code });
}
import { Result } from "better-result";
