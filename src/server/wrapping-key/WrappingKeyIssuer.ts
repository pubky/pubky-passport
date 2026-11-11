import "server-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import type { CodedFailure } from "@/libs/result";
import {
  deriveWrappingKey,
  type VerifiedProviderIdentity,
  type WrappingKeyProvider,
} from "./deriveWrappingKey";

/** Verifies one provider's ID tokens. Failures carry that provider's public error codes. */
export type IdTokenVerifier<VerifierErrorCode extends string> = {
  verifyIdToken(
    idToken: string,
  ): Promise<ResultType<VerifiedProviderIdentity, CodedFailure<VerifierErrorCode>>>;
};

export type WrappingKeyIssueErrorCode<VerifierErrorCode extends string> =
  VerifierErrorCode | "key_derivation_failed" | "key_unavailable";

export type WrappingKeyIssueResult<VerifierErrorCode extends string> = ResultType<
  { wrappingKey: string; keyId: string },
  CodedFailure<WrappingKeyIssueErrorCode<VerifierErrorCode>>
>;

/** Verifies provider identities and derives wrapping keys from versioned server secrets. */
export class WrappingKeyIssuer<VerifierErrorCode extends string> {
  /**
   * @param provider Provider whose verified identities this issuer accepts.
   * @param verifier Verifies the provider's ID tokens.
   * @param verifierUnavailableCode Code returned when the verifier itself throws.
   * @param currentKeyId Key ID used when creating a new Passport file.
   * @param secrets Server secrets indexed by the public key IDs stored in Passport envelopes.
   */
  constructor(
    private readonly provider: WrappingKeyProvider,
    private readonly verifier: IdTokenVerifier<VerifierErrorCode>,
    private readonly verifierUnavailableCode: VerifierErrorCode,
    private readonly currentKeyId: string,
    private readonly secrets: ReadonlyMap<string, Buffer>,
  ) {}

  /**
   * Verifies the ID token and derives its deterministic wrapping key.
   *
   * @param requestedKeyId Key ID from an existing Passport envelope. Omit it to
   * use the current key for a new envelope; an unknown ID returns `key_unavailable`.
   * @returns Verification, selection, and derivation failures as a Result. The
   * promise does not intentionally reject.
   */
  async issueWrappingKey(
    idToken: string,
    requestedKeyId?: string,
  ): Promise<WrappingKeyIssueResult<VerifierErrorCode>> {
    const event = `identity.${this.provider}.wrapping_key.failed`;
    let identity: ResultType<VerifiedProviderIdentity, CodedFailure<VerifierErrorCode>>;
    try {
      identity = await this.verifier.verifyIdToken(idToken);
    } catch (e) {
      LOGGER.error(event, {
        layer: "server",
        operation: "verify",
        code: this.verifierUnavailableCode,
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: this.verifierUnavailableCode, cause: e });
    }

    if (Result.isError(identity)) return Result.err(identity.error);
    if (identity.value.provider !== this.provider) {
      LOGGER.error(event, { layer: "server", operation: "verify", code: "provider_mismatch" });
      return Result.err({ code: "key_derivation_failed" });
    }

    const keyId = requestedKeyId ?? this.currentKeyId;
    const secret = this.secrets.get(keyId);
    if (!secret) {
      LOGGER.warn(event, {
        layer: "server",
        operation: "select_key",
        code: "key_unavailable",
      });
      return Result.err({ code: "key_unavailable" });
    }

    try {
      const wrappingKey = deriveWrappingKey(secret, identity.value);
      return Result.ok({ wrappingKey, keyId });
    } catch (e) {
      LOGGER.error(event, {
        layer: "server",
        operation: "derive",
        code: "key_derivation_failed",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "key_derivation_failed", cause: e });
    }
  }
}
