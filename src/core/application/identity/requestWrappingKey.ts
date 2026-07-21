import { Result, type Result as ResultType } from "better-result";

import type { IdentityProviderId, VerifiedProviderIdentity } from "../../domain/provider/identityProvider";
import type { Clock } from "../../ports/clock";
import type {
  ProviderIdTokenVerificationFailureReason,
  ProviderIdTokenVerifier,
} from "../../ports/providerIdTokenVerifier";
import type { WrappingKeyDeriver } from "../../ports/wrappingKeyDeriver";
import type { WrappingKeyRateLimiter } from "../../ports/wrappingKeyRateLimiter";

type ProviderVerificationResult =
  | { kind: "verified"; identity: VerifiedProviderIdentity }
  | { kind: "failed"; reason: ProviderIdTokenVerificationFailureReason }
  | { kind: "dependency_unavailable" };

export type RequestWrappingKeyInput = {
  provider: IdentityProviderId;
  idToken: string;
};

export type RequestWrappingKeyErrorCode =
  | "invalid_id_token"
  | "expired_id_token"
  | "unsupported_issuer"
  | "unsupported_audience"
  | "missing_subject"
  | "rate_limited"
  | "dependency_unavailable";

export type RequestWrappingKeyResult = ResultType<string, { code: RequestWrappingKeyErrorCode }>;

export type RequestWrappingKeyUseCase = (input: RequestWrappingKeyInput) => Promise<RequestWrappingKeyResult>;

export type RequestWrappingKeyDependencies = {
  providerIdTokenVerifier: ProviderIdTokenVerifier;
  wrappingKeyDeriver: WrappingKeyDeriver;
  wrappingKeyRateLimiter: WrappingKeyRateLimiter;
  clock: Clock;
};

export function createRequestWrappingKeyUseCase(
  dependencies: RequestWrappingKeyDependencies,
): RequestWrappingKeyUseCase {
  return async function requestWrappingKey(input) {
    if (input.provider !== dependencies.providerIdTokenVerifier.provider) {
      return failure("dependency_unavailable");
    }

    const verification = await verifyProviderIdToken(dependencies.providerIdTokenVerifier, input.idToken);
    if (verification.kind === "dependency_unavailable") {
      return failure("dependency_unavailable");
    }

    if (verification.kind === "failed") {
      return failure(mapVerificationFailure(verification.reason));
    }

    if (verification.identity.provider !== input.provider) {
      return failure("dependency_unavailable");
    }

    const rateLimit = await checkRateLimit(dependencies, verification.identity.issuer, verification.identity.subject);
    if (rateLimit) {
      return rateLimit;
    }

    try {
      const { wrappingKey } = await dependencies.wrappingKeyDeriver.deriveWrappingKey({
        provider: verification.identity.provider,
        issuer: verification.identity.issuer,
        subject: verification.identity.subject,
      });

      return Result.ok(wrappingKey);
    } catch {
      return failure("dependency_unavailable");
    }
  };
}

async function verifyProviderIdToken(
  verifier: ProviderIdTokenVerifier,
  idToken: string,
): Promise<ProviderVerificationResult> {
  try {
    const result = await verifier.verifyIdToken(idToken);

    if (result.ok) {
      return { kind: "verified", identity: result.identity };
    }

    return { kind: "failed", reason: result.reason };
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
      provider: dependencies.providerIdTokenVerifier.provider,
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

function mapVerificationFailure(reason: ProviderIdTokenVerificationFailureReason): RequestWrappingKeyErrorCode {
  switch (reason) {
    case "expired":
      return "expired_id_token";
    case "unsupported_issuer":
      return "unsupported_issuer";
    case "unsupported_audience":
      return "unsupported_audience";
    case "missing_subject":
      return "missing_subject";
    case "invalid":
      return "invalid_id_token";
  }
}
