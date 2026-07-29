import "server-only";

import { Result, type Result as ResultType } from "better-result";

import {
  GoogleIdTokenVerifier,
  type GoogleIdTokenVerificationErrorCode,
  type VerifiedGoogleIdentity,
} from "../adapters/googleIdTokenVerifier";

export type CheckGoogleWrappingKeyRateLimit = (
  identity: VerifiedGoogleIdentity,
) => Promise<boolean>;

export type DeriveGoogleWrappingKey = (
  identity: VerifiedGoogleIdentity,
) => string;

export type GoogleWrappingKeyRequestErrorCode =
  | GoogleIdTokenVerificationErrorCode
  | "rate_limited"
  | "dependency_unavailable";

export type GoogleWrappingKeyRequestResult = ResultType<string, { code: GoogleWrappingKeyRequestErrorCode }>;

export type RequestGoogleWrappingKey = (
  googleIdToken: string,
) => Promise<GoogleWrappingKeyRequestResult>;

type RequestGoogleWrappingKeyDependencies = {
  googleIdTokenVerifier: GoogleIdTokenVerifier;
  checkRateLimit: CheckGoogleWrappingKeyRateLimit;
  deriveWrappingKey: DeriveGoogleWrappingKey;
};

export function createRequestGoogleWrappingKey(
  dependencies: RequestGoogleWrappingKeyDependencies,
): RequestGoogleWrappingKey {
  return async function requestGoogleWrappingKey(googleIdToken) {
    try {
      const identity = await dependencies.googleIdTokenVerifier.verifyGoogleIdToken(googleIdToken);
      if (Result.isError(identity)) {
        return failure(identity.error.code);
      }

      if (!await dependencies.checkRateLimit(identity.value)) {
        return failure("rate_limited");
      }

      return Result.ok(dependencies.deriveWrappingKey(identity.value));
    } catch {
      return failure("dependency_unavailable");
    }
  };
}

function failure(code: GoogleWrappingKeyRequestErrorCode): GoogleWrappingKeyRequestResult {
  return Result.err({ code });
}
