import type { Clock } from "../../ports/clock";
import type {
  GoogleIdTokenVerifier,
  GoogleIdTokenVerificationFailureReason,
} from "../../ports/googleIdTokenVerifier";
import type { WrappingKeyDeriver } from "../../ports/wrappingKeyDeriver";
import type { WrappingKeyRateLimiter } from "../../ports/wrappingKeyRateLimiter";

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

export type RequestWrappingKeyResult =
  | { ok: true; wrappingKey: string }
  | { ok: false; error: { code: RequestWrappingKeyErrorCode } };

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
    if (!verification.ok && "dependencyUnavailable" in verification) {
      return { ok: false, error: { code: "dependency_unavailable" } };
    }

    if (!verification.ok) {
      return { ok: false, error: { code: mapVerificationFailure(verification.reason) } };
    }

    const rateLimit = await checkRateLimit(dependencies, verification.identity.issuer, verification.identity.subject);
    if (!rateLimit.ok) {
      return rateLimit.result;
    }

    try {
      const { wrappingKey } = await dependencies.wrappingKeyDeriver.deriveWrappingKey({
        issuer: verification.identity.issuer,
        subject: verification.identity.subject,
      });

      return { ok: true, wrappingKey };
    } catch {
      return { ok: false, error: { code: "dependency_unavailable" } };
    }
  };
}

async function verifyGoogleIdToken(
  verifier: GoogleIdTokenVerifier,
  googleIdToken: string,
): Promise<
  | Awaited<ReturnType<GoogleIdTokenVerifier["verifyIdToken"]>>
  | { ok: false; dependencyUnavailable: true }
> {
  try {
    return await verifier.verifyIdToken(googleIdToken);
  } catch {
    return { ok: false, dependencyUnavailable: true };
  }
}

async function checkRateLimit(
  dependencies: RequestWrappingKeyDependencies,
  issuer: string,
  subject: string,
): Promise<{ ok: true } | { ok: false; result: RequestWrappingKeyResult }> {
  try {
    const result = await dependencies.wrappingKeyRateLimiter.checkWrappingKeyRequest({
      issuer,
      subject,
      at: dependencies.clock.now(),
    });

    if (!result.allowed) {
      return { ok: false, result: { ok: false, error: { code: "rate_limited" } } };
    }

    return { ok: true };
  } catch {
    return { ok: false, result: { ok: false, error: { code: "dependency_unavailable" } } };
  }
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
