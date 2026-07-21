import "server-only";

import { hkdfSync } from "node:crypto";

import { hasMinimumServerSecretBytes, isBase64 } from "../../libs/security/serverSecret";
import { canonicalGoogleIssuer, type VerifiedGoogleIdentity } from "./googleIdTokenVerifier";

export type WrappingKeyMaterial = {
  deriveWrappingKey(identity: VerifiedGoogleIdentity): Promise<{ wrappingKey: string }>;
};

export type CreateWrappingKeyMaterialInput = {
  serverSecretBase64: string;
};

const wrappingKeyBytes = 32;
const hkdfSalt = Buffer.from("pubky-passport/wrapping-key/salt/v1", "utf8");
const hkdfInfoPrefix = "google:";

export function createWrappingKeyMaterial(input: CreateWrappingKeyMaterialInput): WrappingKeyMaterial {
  const serverSecret = decodeServerSecret(input.serverSecretBase64);

  return {
    async deriveWrappingKey(identity) {
      if (identity.issuer !== canonicalGoogleIssuer || !identity.subject.trim()) {
        throw new Error("Invalid wrapping key identity.");
      }

      const info = Buffer.from(`${hkdfInfoPrefix}${identity.issuer}\n${identity.subject}`, "utf8");
      const derivedKey = Buffer.from(hkdfSync("sha256", serverSecret, hkdfSalt, info, wrappingKeyBytes));

      return { wrappingKey: derivedKey.toString("base64url") };
    },
  };
}

export function decodeServerSecret(serverSecretBase64: string): Buffer {
  if (!isBase64(serverSecretBase64)) {
    throw invalidConfigurationError();
  }

  const decoded = Buffer.from(serverSecretBase64, "base64");
  if (!hasMinimumServerSecretBytes(decoded)) {
    throw invalidConfigurationError();
  }

  return decoded;
}

function invalidConfigurationError(): Error {
  return new Error("Invalid wrapping key configuration.");
}
