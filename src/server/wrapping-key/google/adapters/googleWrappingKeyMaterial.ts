import "server-only";

import { hkdfSync } from "node:crypto";

import {
  CANONICAL_GOOGLE_ISSUER,
  type GoogleWrappingKeyMaterial,
} from "../application/googleWrappingKey";
import { decodeServerSecret } from "./serverSecret";

export type CreateGoogleWrappingKeyMaterialInput = {
  serverSecretBase64: string;
};

const WRAPPING_KEY_BYTES = 32;
const GOOGLE_WRAPPING_KEY_HKDF_SALT = Buffer.from("pubky-passport/wrapping-key/salt/v1", "utf8");
const GOOGLE_WRAPPING_KEY_HKDF_INFO_PREFIX = "google:";

export function createGoogleWrappingKeyMaterial(
  input: CreateGoogleWrappingKeyMaterialInput,
): GoogleWrappingKeyMaterial {
  const serverSecret = decodeServerSecret(input.serverSecretBase64);

  return {
    async deriveWrappingKey(identity) {
      if (identity.issuer !== CANONICAL_GOOGLE_ISSUER || !identity.subject.trim()) {
        throw new Error("Invalid wrapping key identity.");
      }

      const info = Buffer.from(`${GOOGLE_WRAPPING_KEY_HKDF_INFO_PREFIX}${identity.issuer}\n${identity.subject}`, "utf8");
      const derivedKey = Buffer.from(hkdfSync("sha256", serverSecret, GOOGLE_WRAPPING_KEY_HKDF_SALT, info, WRAPPING_KEY_BYTES));

      return { wrappingKey: derivedKey.toString("base64url") };
    },
  };
}
