import "client-only";

export { isCanonicalPubkyPublicKey } from "@/libs/pubkyPublicKey";

const BASE64_URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Canonical 32-byte Pubky Auth secret encoded without base64 padding. */
export function isCanonicalPubkyAuthSecret(value: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) return false;
  const lastCharacter = value.at(-1);
  return lastCharacter !== undefined && BASE64_URL_ALPHABET.indexOf(lastCharacter) % 4 === 0;
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
  return codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f));
}
