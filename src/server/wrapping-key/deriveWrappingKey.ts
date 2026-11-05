import "server-only";

import { hkdfSync } from "node:crypto";

/** Sign-in providers whose verified identities can unlock a Passport file. */
export type WrappingKeyProvider = "google";

/** An identity whose ID token the server verified. Only these fields reach key derivation. */
export type VerifiedProviderIdentity = Readonly<{
  provider: WrappingKeyProvider;
  issuer: string;
  subject: string;
}>;

const WRAPPING_KEY_BYTES = 32;
const WRAPPING_KEY_HKDF_SALT = Buffer.from("pubky-passport/wrapping-key/salt/v1", "utf8");

/**
 * Derives the account-bound wrapping key. The HKDF info is `<provider>:<issuer>\n<subject>`, so
 * the same subject string at two providers never yields the same key.
 */
export function deriveWrappingKey(
  serverSecret: Uint8Array,
  identity: VerifiedProviderIdentity,
): string {
  if (!identity.subject.trim() || !identity.issuer.trim()) {
    throw new Error("Invalid wrapping key identity.");
  }

  const info = Buffer.from(`${identity.provider}:${identity.issuer}\n${identity.subject}`, "utf8");
  return Buffer.from(
    hkdfSync("sha256", serverSecret, WRAPPING_KEY_HKDF_SALT, info, WRAPPING_KEY_BYTES),
  ).toString("base64url");
}
