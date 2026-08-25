import "server-only";

import { Result, type Result as ResultType } from "better-result";

import type { GoogleWrappingKey } from "../../../libs/googleWrappingKeyApi";
import { LOGGER } from "../../../libs/logger/logger";
import type { CodedFailure } from "../../../libs/result";
import {
  getApplicationEnvironment,
  type ServerSecretKeyring,
} from "../../config/applicationEnvironment";
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
  GoogleWrappingKey,
  CodedFailure<GoogleWrappingKeyIssueErrorCode>
>;

export type GoogleWrappingKeyIssuer = {
  issueGoogleWrappingKey: (
    googleIdToken: string,
    keyId?: string,
  ) => Promise<GoogleWrappingKeyIssueResult>;
};

type VerifyGoogleIdToken = (token: string) => Promise<GoogleIdTokenVerificationResult>;

export function createGoogleWrappingKeyIssuer(
  verifyGoogleIdToken: VerifyGoogleIdToken,
  keyring: ServerSecretKeyring,
): GoogleWrappingKeyIssuer {
  return {
    async issueGoogleWrappingKey(googleIdToken, requestedKeyId) {
      let identity: GoogleIdTokenVerificationResult;
      try {
        identity = await verifyGoogleIdToken(googleIdToken);
      } catch (cause) {
        LOGGER.error("identity.google.wrapping_key.failed", {
          layer: "server",
          operation: "verify",
          code: "dependency_unavailable",
        });
        return Result.err({ code: "dependency_unavailable", cause });
      }

      if (Result.isError(identity)) return Result.err(identity.error);

      const selected = selectServerSecret(keyring, requestedKeyId);
      if (!selected) {
        LOGGER.warn("identity.google.wrapping_key.failed", {
          layer: "server",
          operation: "select_key",
          code: "key_unavailable",
        });
        return Result.err({ code: "key_unavailable" });
      }

      try {
        const wrappingKey = deriveGoogleWrappingKey(selected.secret, identity.value);
        return Result.ok(selected.keyId
          ? { wrappingKey, keyId: selected.keyId }
          : { wrappingKey });
      } catch (cause) {
        LOGGER.error("identity.google.wrapping_key.failed", {
          layer: "server",
          operation: "derive",
          code: "dependency_unavailable",
        });
        return Result.err({ code: "dependency_unavailable", cause });
      }
    },
  };
}

export function createGoogleWrappingKeyIssuerFromEnvironment(): GoogleWrappingKeyIssuer {
  const { googleClientId, serverSecretKeyring } = getApplicationEnvironment();
  const verifier = new GoogleIdTokenVerifier(googleClientId);
  return createGoogleWrappingKeyIssuer(
    (token) => verifier.verifyGoogleIdToken(token),
    serverSecretKeyring,
  );
}

function selectServerSecret(
  keyring: ServerSecretKeyring,
  requestedKeyId: string | undefined,
): { keyId?: string; secret: Buffer } | null {
  if (requestedKeyId) {
    const secret = keyring.secretsByKeyId.get(requestedKeyId);
    return secret ? { keyId: requestedKeyId, secret } : null;
  }
  if (keyring.currentKeyId) {
    const secret = keyring.secretsByKeyId.get(keyring.currentKeyId);
    return secret ? { keyId: keyring.currentKeyId, secret } : null;
  }
  return { secret: keyring.legacyV1Secret };
}
