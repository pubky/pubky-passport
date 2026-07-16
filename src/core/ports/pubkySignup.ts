import type { Result } from "better-result";

import type {
  PubkyIdentityKeyHandle,
  PubkyIdentitySession,
} from "../domain/identity/pubkyIdentity";

export type PubkySignupErrorCode =
  | "invalid_homeserver_pubky"
  | "key_unavailable"
  | "signin_failed"
  | "signup_failed";

export type PubkySignupError = {
  code: PubkySignupErrorCode;
};

export type PubkySignupResult<T> = Result<T, PubkySignupError>;

export type SignupWithPubkyInput = {
  keyHandle: PubkyIdentityKeyHandle;
  homeserverPubky: string;
  signupCode?: string | null;
};

export type SigninWithPubkyInput = {
  keyHandle: PubkyIdentityKeyHandle;
  waitForDiscovery?: boolean;
};

export interface PubkySignup {
  signup(input: SignupWithPubkyInput): Promise<PubkySignupResult<PubkyIdentitySession>>;
  signin(input: SigninWithPubkyInput): Promise<PubkySignupResult<PubkyIdentitySession>>;
}
