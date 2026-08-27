import "client-only";

const BASE64_URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const Z_BASE_32_ALPHABET = "ybndrfg8ejkmcpqxot1uwisza345h769";

/** Canonical 32-byte Pubky Auth secret encoded without base64 padding. */
export function isCanonicalPubkyAuthSecret(value: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) return false;
  const lastCharacter = value.at(-1);
  return lastCharacter !== undefined && BASE64_URL_ALPHABET.indexOf(lastCharacter) % 4 === 0;
}

/** Canonical z-base-32 Ed25519 public key used at every Pubky boundary. */
export function isCanonicalPubkyPublicKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 52) return false;
  for (const character of value) {
    if (!Z_BASE_32_ALPHABET.includes(character)) return false;
  }
  return value.endsWith("y") || value.endsWith("o");
}

/** Pubky capability path rules shared by request parsing and review. */
export function isValidPubkyCapabilityPath(path: string): boolean {
  if (!path.startsWith("/") || /[:,]/u.test(path)) return false;
  if (/[\p{Bidi_Control}\p{Default_Ignorable_Code_Point}]/u.test(path)) return false;
  if (path === "/") return true;
  if (/\s$/u.test(path)) return false;

  const segments = path.slice(1).split("/");
  return segments.every((segment, index) => {
    if (segment.length === 0) return index === segments.length - 1;
    if (segment === "." || segment === "..") return false;
    if (utf8Length(segment) > 255 || segment.includes("\\")) return false;
    return ![...segment].some(isControlCharacter);
  });
}

export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && (
    codePoint <= 0x1f
    || (codePoint >= 0x7f && codePoint <= 0x9f)
  );
}
