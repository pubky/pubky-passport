import "server-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER, safeErrorLogFields } from "../../../libs/logger/logger";
import type { CodedFailure } from "../../../libs/result";
import { getPublicEnvironment, getServerEnvironment } from "../../environment";
import {
  GoogleIdTokenVerifier,
  type GoogleIdTokenVerificationResult,
} from "./GoogleIdTokenVerifier";
import { deriveGoogleWrappingKey } from "./deriveGoogleWrappingKey";

export type GoogleWrappingKeyIssueErrorCode =
  | "google_verifier_unavailable"
  | "invalid_google_id_token"
  | "key_derivation_failed"
  | "key_unavailable";

export type GoogleWrappingKeyIssueResult = ResultType<
  { wrappingKey: string; keyId: string },
  CodedFailure<GoogleWrappingKeyIssueErrorCode>
>;

/** Verifies Google identities and derives wrapping keys from versioned server secrets. */
export class GoogleWrappingKeyIssuer {
  private readonly googleIdTokenVerifier: GoogleIdTokenVerifier;

  /**
   * @param googleClientId Audience required in every accepted Google ID token.
   * @param currentKeyId Key ID used when creating a new Passport file.
   * @param secrets Server secrets indexed by the public key IDs stored in Passport envelopes.
   */
  constructor(
    googleClientId: string,
    private readonly currentKeyId: string,
    private readonly secrets: ReadonlyMap<string, Buffer>,
  ) {
    this.googleIdTokenVerifier = new GoogleIdTokenVerifier(googleClientId);
  }

  /** @throws {Error} when required server configuration is missing or invalid. */
  static fromEnvironment(): GoogleWrappingKeyIssuer {
    const { googleClientId } = getPublicEnvironment();
    const { currentKeyId, secrets } = getServerEnvironment();
    return new GoogleWrappingKeyIssuer(googleClientId, currentKeyId, secrets);
  }

  /**
   * Verifies the Google ID token and derives its deterministic wrapping key.
   *
   * @param requestedKeyId Key ID from an existing Passport envelope. Omit it to
   * use the current key for a new envelope; an unknown ID returns `key_unavailable`.
   * @returns Verification, selection, and derivation failures as a Result. The
   * promise does not intentionally reject.
   */
  async issueGoogleWrappingKey(
    googleIdToken: string,
    requestedKeyId?: string,
  ): Promise<GoogleWrappingKeyIssueResult> {
    let identity: GoogleIdTokenVerificationResult;
    try {
      identity = await this.googleIdTokenVerifier.verifyGoogleIdToken(googleIdToken);
    } catch (e) {
      LOGGER.error("identity.google.wrapping_key.failed", {
        layer: "server",
        operation: "verify",
        code: "google_verifier_unavailable",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "google_verifier_unavailable", cause: e });
    }

    if (Result.isError(identity)) return Result.err(identity.error);

    const keyId = requestedKeyId ?? this.currentKeyId;
    const secret = this.secrets.get(keyId);
    if (!secret) {
      LOGGER.warn("identity.google.wrapping_key.failed", {
        layer: "server",
        operation: "select_key",
        code: "key_unavailable",
      });
      return Result.err({ code: "key_unavailable" });
    }

    try {
      const wrappingKey = deriveGoogleWrappingKey(secret, identity.value);
      return Result.ok({ wrappingKey, keyId });
    } catch (e) {
      LOGGER.error("identity.google.wrapping_key.failed", {
        layer: "server",
        operation: "derive",
        code: "key_derivation_failed",
        ...safeErrorLogFields(e),
      });
      return Result.err({ code: "key_derivation_failed", cause: e });
    }
  }
}
