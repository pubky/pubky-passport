import { Result, type Result as ResultType } from "better-result";

import type { Clock } from "../../ports/clock";
import type {
  GoogleIdTokenVerifier,
  GoogleIdTokenVerificationFailureReason,
  VerifiedGoogleIdentity,
} from "../../ports/googleIdTokenVerifier";
import type { WrappingKeyDeriver } from "../../ports/wrappingKeyDeriver";
import type { WrappingKeyRateLimiter } from "../../ports/wrappingKeyRateLimiter";

type GoogleVerificationResult =
  | { kind: "verified"; identity: VerifiedGoogleIdentity }
  | { kind: "failed"; reason: GoogleIdTokenVerificationFailureReason }
  | { kind: "dependency_unavailable" };

export type RequestWrappingKeyInput = {
  googleIdToken: string;
};

export type RequestWrappingKeyErrorCode =
  | "invalid_google_id_token"
  | "expired_google_id_token"
  | "unsupported_google_issuer"
  | "unsupported_google_audience"
  | "missing_google_subject"
  | "rate_limited"
  | "dependency_unavailable";

export type RequestWrappingKeyResult = ResultType<string, { code: RequestWrappingKeyErrorCode }>;

export type RequestWrappingKeyUseCase = (input: RequestWrappingKeyInput) => Promise<RequestWrappingKeyResult>;

export type RequestWrappingKeyDependencies = {
  googleIdTokenVerifier: GoogleIdTokenVerifier;
  wrappingKeyDeriver: WrappingKeyDeriver;
  wrappingKeyRateLimiter: WrappingKeyRateLimiter;
  clock: Clock;
};

export function createRequestWrappingKeyUseCase(
  dependencies: RequestWrappingKeyDependencies,
): RequestWrappingKeyUseCase {
  return async function requestWrappingKey(input) {
    const verification = await verifyGoogleIdToken(dependencies.googleIdTokenVerifier, input.googleIdToken);
    if (verification.kind === "dependency_unavailable") {
      return failure("dependency_unavailable");
    }

    if (verification.kind === "failed") {
      return failure(mapVerificationFailure(verification.reason));
    }

    const rateLimit = await checkRateLimit(dependencies, verification.identity.issuer, verification.identity.subject);
    if (rateLimit) {
      return rateLimit;
    }

    try {
      const { wrappingKey } = await dependencies.wrappingKeyDeriver.deriveWrappingKey({
        issuer: verification.identity.issuer,
        subject: verification.identity.subject,
      });

      return Result.ok(wrappingKey);
    } catch {
      return failure("dependency_unavailable");
    }
  };
}

async function verifyGoogleIdToken(
  verifier: GoogleIdTokenVerifier,
  googleIdToken: string,
): Promise<GoogleVerificationResult> {
  try {
    const result = await verifier.verifyIdToken(googleIdToken);

    if (Result.isOk(result)) {
      return { kind: "verified", identity: result.value };
    }

    return { kind: "failed", reason: result.error };
  } catch {
    return { kind: "dependency_unavailable" };
  }
}

async function checkRateLimit(
  dependencies: RequestWrappingKeyDependencies,
  issuer: string,
  subject: string,
): Promise<RequestWrappingKeyResult | undefined> {
  try {
    const result = await dependencies.wrappingKeyRateLimiter.checkWrappingKeyRequest({
      issuer,
      subject,
      at: dependencies.clock.now(),
    });

    if (!result.allowed) {
      return failure("rate_limited");
    }

    return undefined;
  } catch {
    return failure("dependency_unavailable");
  }
}

function failure(code: RequestWrappingKeyErrorCode): RequestWrappingKeyResult {
  return Result.err({ code });
}

function mapVerificationFailure(reason: GoogleIdTokenVerificationFailureReason): RequestWrappingKeyErrorCode {
  switch (reason) {
    case "expired":
      return "expired_google_id_token";
    case "unsupported_issuer":
      return "unsupported_google_issuer";
    case "unsupported_audience":
      return "unsupported_google_audience";
    case "missing_subject":
      return "missing_google_subject";
    case "invalid":
      return "invalid_google_id_token";
  }
}
