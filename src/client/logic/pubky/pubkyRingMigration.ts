import "client-only";

import { PUBKY_SECRET_KEY_BYTES } from "./pubkyIdentityKey";

/** Concrete Pubky Ring URL contract. */
export function createPubkyRingMigrationUrl(secretKey: Uint8Array): string | null {
  if (secretKey.byteLength !== PUBKY_SECRET_KEY_BYTES) return null;
  const key = Array.from(secretKey, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `pubkyring://migrate?index=0&total=1&key=${key}`;
}
