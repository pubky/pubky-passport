import "server-only";

import { hkdfSync } from "node:crypto";

import { CANONICAL_GOOGLE_ISSUER, type VerifiedGoogleIdentity } from "./GoogleIdTokenVerifier";

const WRAPPING_KEY_BYTES = 32;
const GOOGLE_WRAPPING_KEY_HKDF_SALT = Buffer.from("pubky-passport/wrapping-key/salt/v1", "utf8");
const GOOGLE_WRAPPING_KEY_HKDF_INFO_PREFIX = "google:";

export function deriveGoogleWrappingKey(
  serverSecret: Uint8Array,
  identity: VerifiedGoogleIdentity,
): string {
  if (identity.issuer !== CANONICAL_GOOGLE_ISSUER || !identity.googleSubject.trim()) {
    throw new Error("Invalid wrapping key identity.");
  }

  const info = Buffer.from(
    `${GOOGLE_WRAPPING_KEY_HKDF_INFO_PREFIX}${identity.issuer}\n${identity.googleSubject}`,
    "utf8",
  );
  const serverSecretCopy = Buffer.from(serverSecret);
  let derivedKey: Buffer | undefined;
  try {
    derivedKey = Buffer.from(
      hkdfSync("sha256", serverSecretCopy, GOOGLE_WRAPPING_KEY_HKDF_SALT, info, WRAPPING_KEY_BYTES),
    );
    return derivedKey.toString("base64url");
  } finally {
    serverSecretCopy.fill(0);
    derivedKey?.fill(0);
    info.fill(0);
  }
}
