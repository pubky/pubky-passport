import { decodeBase64Url, encodeBase64Url } from "@/libs/encoding/base64Url";

/** The preimage's length in bytes: as canonical unpadded base64url, exactly 43 characters. */
const PREIMAGE_BYTES = 32;

/**
 * Whether `value` is a Google nonce preimage: 32 bytes as canonical unpadded base64url. Passport
 * sends Google only the preimage's hash as the OAuth `nonce`, and its own wrapping-key endpoint the
 * preimage itself, so an ID token alone (Homegate receives one) never unlocks a wrapping key.
 */
export function isGoogleNoncePreimage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === 43 &&
    decodeBase64Url(value)?.byteLength === PREIMAGE_BYTES
  );
}

/** A fresh preimage, from the platform's random source. */
export function createGoogleNoncePreimage(): string {
  return encodeBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(PREIMAGE_BYTES)));
}

/**
 * The OAuth nonce that commits to `preimage`: base64url(SHA-256(preimage bytes)). Throws for a
 * value that is not a preimage (see {@link isGoogleNoncePreimage}).
 */
export async function googleNonceFor(preimage: string): Promise<string> {
  const bytes = isGoogleNoncePreimage(preimage) ? decodeBase64Url(preimage) : undefined;
  if (!bytes) throw new Error("Not a Google nonce preimage.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return encodeBase64Url(new Uint8Array(digest));
}
