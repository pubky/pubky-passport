import "server-only";

import { hkdfSync } from "node:crypto";

import type { VerifiedGoogleIdentity } from "./GoogleIdTokenVerifier";

const WRAPPING_KEY_BYTES = 32;
const GOOGLE_WRAPPING_KEY_HKDF_SALT = Buffer.from("pubky-passport/wrapping-key/salt/v1", "utf8");
const GOOGLE_WRAPPING_KEY_HKDF_INFO_PREFIX = "google:";

export function deriveGoogleWrappingKey(
  serverSecret: Uint8Array,
  identity: VerifiedGoogleIdentity,
): string {
  if (!identity.googleSubject.trim()) {
    throw new Error("Invalid wrapping key identity.");
  }

  const info = Buffer.from(
    `${GOOGLE_WRAPPING_KEY_HKDF_INFO_PREFIX}${identity.issuer}\n${identity.googleSubject}`,
    "utf8",
  );
  return Buffer.from(
    hkdfSync("sha256", serverSecret, GOOGLE_WRAPPING_KEY_HKDF_SALT, info, WRAPPING_KEY_BYTES),
  ).toString("base64url");
}
