const Z_BASE_32_ALPHABET = "ybndrfg8ejkmcpqxot1uwisza345h769";

/** Canonical z-base-32 Ed25519 public key used at every Pubky boundary. */
export function isCanonicalPubkyPublicKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 52) return false;
  for (const character of value) {
    if (!Z_BASE_32_ALPHABET.includes(character)) return false;
  }
  return value.endsWith("y") || value.endsWith("o");
}
