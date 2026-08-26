import "server-only";

import { Result, type Result as ResultType } from "better-result";

import { LOGGER } from "../../../libs/logger/logger";
import type { CodedFailure } from "../../../libs/result";
import { getApplicationEnvironment } from "../../config/applicationEnvironment";
import {
  GoogleIdTokenVerifier,
  type GoogleIdTokenVerificationResult,
} from "./GoogleIdTokenVerifier";
import { deriveGoogleWrappingKey } from "./GoogleWrappingKeyDeriver";

export type GoogleWrappingKeyIssueErrorCode =
  | "invalid_google_id_token"
  | "key_unavailable"
  | "dependency_unavailable";

export type GoogleWrappingKeyIssueResult = ResultType<
  { wrappingKey: string; keyId: string },
  CodedFailure<GoogleWrappingKeyIssueErrorCode>
>;

export class GoogleWrappingKeyIssuer {
  constructor(
    private readonly verifyGoogleIdToken: (token: string) => Promise<GoogleIdTokenVerificationResult>,
    private readonly currentKeyId: string,
    private readonly secrets: ReadonlyMap<string, Buffer>,
  ) {}

  static fromEnvironment(): GoogleWrappingKeyIssuer {
    const { googleClientId, serverSecretCurrentKeyId, serverSecrets } = getApplicationEnvironment();
    const verifier = new GoogleIdTokenVerifier(googleClientId);
    return new GoogleWrappingKeyIssuer(
      (token) => verifier.verifyGoogleIdToken(token),
      serverSecretCurrentKeyId,
      serverSecrets,
    );
  }

  async issueGoogleWrappingKey(
    googleIdToken: string,
    requestedKeyId?: string,
  ): Promise<GoogleWrappingKeyIssueResult> {
    let identity: GoogleIdTokenVerificationResult;
    try {
      identity = await this.verifyGoogleIdToken(googleIdToken);
    } catch (cause) {
      LOGGER.error("identity.google.wrapping_key.failed", {
        layer: "server",
        operation: "verify",
        code: "dependency_unavailable",
      });
      return Result.err({ code: "dependency_unavailable", cause });
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
    } catch (cause) {
      LOGGER.error("identity.google.wrapping_key.failed", {
        layer: "server",
        operation: "derive",
        code: "dependency_unavailable",
      });
      return Result.err({ code: "dependency_unavailable", cause });
    }
  }
}
