import "server-only";

import { hkdfSync } from "node:crypto";

import { hasMinimumServerSecretBytes, isBase64 } from "../../../libs/security/serverSecret";
import { canonicalGoogleIssuer, type GoogleWrappingKeyMaterial } from "./ports";

export type CreateGoogleWrappingKeyMaterialInput = {
  serverSecretBase64: string;
};

const wrappingKeyBytes = 32;
const googleWrappingKeyHkdfSalt = Buffer.from("pubky-passport/wrapping-key/salt/v1", "utf8");
const googleWrappingKeyHkdfInfoPrefix = "google:";

export function createGoogleWrappingKeyMaterial(
  input: CreateGoogleWrappingKeyMaterialInput,
): GoogleWrappingKeyMaterial {
  const serverSecret = decodeServerSecret(input.serverSecretBase64);

  return {
    async deriveWrappingKey(identity) {
      if (identity.issuer !== canonicalGoogleIssuer || !identity.subject.trim()) {
        throw new Error("Invalid wrapping key identity.");
      }

      const info = Buffer.from(`${googleWrappingKeyHkdfInfoPrefix}${identity.issuer}\n${identity.subject}`, "utf8");
      const derivedKey = Buffer.from(hkdfSync("sha256", serverSecret, googleWrappingKeyHkdfSalt, info, wrappingKeyBytes));

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
