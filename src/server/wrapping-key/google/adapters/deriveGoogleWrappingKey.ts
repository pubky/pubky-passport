import "server-only";

import { hkdfSync } from "node:crypto";

import {
  type DeriveGoogleWrappingKey,
} from "../application/requestGoogleWrappingKey";
import { CANONICAL_GOOGLE_ISSUER } from "./googleIdTokenVerifier";

export type CreateDeriveGoogleWrappingKeyInput = {
  serverSecret: Uint8Array;
};

const WRAPPING_KEY_BYTES = 32;
const GOOGLE_WRAPPING_KEY_HKDF_SALT = Buffer.from("pubky-passport/wrapping-key/salt/v1", "utf8");
const GOOGLE_WRAPPING_KEY_HKDF_INFO_PREFIX = "google:";

export function createDeriveGoogleWrappingKey(
  input: CreateDeriveGoogleWrappingKeyInput,
): DeriveGoogleWrappingKey {
  const serverSecret = Buffer.from(input.serverSecret);

  return function deriveGoogleWrappingKey(identity) {
    if (identity.issuer !== CANONICAL_GOOGLE_ISSUER || !identity.subject.trim()) {
      throw new Error("Invalid wrapping key identity.");
    }

    const info = Buffer.from(`${GOOGLE_WRAPPING_KEY_HKDF_INFO_PREFIX}${identity.issuer}\n${identity.subject}`, "utf8");
    const derivedKey = Buffer.from(hkdfSync("sha256", serverSecret, GOOGLE_WRAPPING_KEY_HKDF_SALT, info, WRAPPING_KEY_BYTES));

    return derivedKey.toString("base64url");
  };
}
