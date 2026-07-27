import "server-only";

import { Result, type Result as ResultType } from "better-result";

import type {
  GoogleIdTokenVerificationErrorCode,
  GoogleIdTokenVerifier,
  VerifiedGoogleIdentity,
  GoogleWrappingKeyMaterial,
  GoogleWrappingKeyRateLimiter,
} from "./googleWrappingKey";

export type GoogleWrappingKeyRequestErrorCode =
  | "invalid_google_id_token"
  | "expired_google_id_token"
  | "unsupported_google_issuer"
  | "unsupported_google_audience"
  | "missing_google_subject"
  | "rate_limited"
  | "dependency_unavailable";

export type GoogleWrappingKeyRequestResult = ResultType<string, { code: GoogleWrappingKeyRequestErrorCode }>;

export type GoogleWrappingKeyRequest = {
  requestWrappingKey(input: { googleIdToken: string }): Promise<GoogleWrappingKeyRequestResult>;
};

export type CreateGoogleWrappingKeyRequestInput = {
  googleIdTokenVerifier: GoogleIdTokenVerifier;
  material: GoogleWrappingKeyMaterial;
  rateLimiter: GoogleWrappingKeyRateLimiter;
  now: () => Date;
};

export function createGoogleWrappingKeyRequest(
  input: CreateGoogleWrappingKeyRequestInput,
): GoogleWrappingKeyRequest {
  return {
    async requestWrappingKey({ googleIdToken }) {
      const identity = await verifyGoogleIdToken(input.googleIdTokenVerifier, googleIdToken);
      if (Result.isError(identity)) {
        return failure(identity.error.code);
      }

      try {
        const rateLimit = await input.rateLimiter.checkRequest({ identity: identity.value, at: input.now() });
        if (!rateLimit.allowed) {
          return failure("rate_limited");
        }

        const { wrappingKey } = await input.material.deriveWrappingKey(identity.value);
        return Result.ok(wrappingKey);
      } catch {
        return failure("dependency_unavailable");
      }
    },
  };
}

async function verifyGoogleIdToken(
  verifier: GoogleIdTokenVerifier,
  googleIdToken: string,
): Promise<ResultType<VerifiedGoogleIdentity, { code: GoogleWrappingKeyRequestErrorCode }>> {
  try {
    const result = await verifier.verifyGoogleIdToken(googleIdToken);
    if (Result.isError(result)) {
      return verificationFailure(mapVerificationError(result.error.code));
    }

    return Result.ok(result.value);
  } catch {
    return verificationFailure("dependency_unavailable");
  }
}

function mapVerificationError(code: GoogleIdTokenVerificationErrorCode): GoogleWrappingKeyRequestErrorCode {
  switch (code) {
    case "invalid":
      return "invalid_google_id_token";
    case "expired":
      return "expired_google_id_token";
    case "unsupported_issuer":
      return "unsupported_google_issuer";
    case "unsupported_audience":
      return "unsupported_google_audience";
    case "missing_subject":
      return "missing_google_subject";
  }
}

function failure(code: GoogleWrappingKeyRequestErrorCode): GoogleWrappingKeyRequestResult {
  return Result.err({ code });
}

function verificationFailure(
  code: GoogleWrappingKeyRequestErrorCode,
): ResultType<VerifiedGoogleIdentity, { code: GoogleWrappingKeyRequestErrorCode }> {
  return Result.err({ code });
}
