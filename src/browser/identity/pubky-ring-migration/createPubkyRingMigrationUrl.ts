import "client-only";

import { Result } from "better-result";

import type { PubkySecretKeyMaterial } from "../../pubky/pubkyIdentityKey";
import type { LocalIdentityResult, LocalIdentitySummary } from "../local/localStorageIdentityRepository";

type ReadActiveIdentity = () => LocalIdentityResult<{
  identity: LocalIdentitySummary;
  secretKey: PubkySecretKeyMaterial;
}>;

export function createPubkyRingMigrationUrl(
  readActiveIdentity: ReadActiveIdentity,
): LocalIdentityResult<string> {
  const stored = readActiveIdentity();
  if (Result.isError(stored)) return Result.err(stored.error);

  try {
    const secretKey = Array.from(stored.value.secretKey.bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return Result.ok(`pubkyring://migrate?index=0&total=1&key=${secretKey}`);
  } finally {
    stored.value.secretKey.bytes.fill(0);
  }
}
