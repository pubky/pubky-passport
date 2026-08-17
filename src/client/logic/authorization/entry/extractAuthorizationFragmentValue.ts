import "client-only";

import { PUBKY_AUTH_REQUEST_LIMITS } from "../request/pubkyAuthRequestLimits";

export type AuthorizationFragmentValue =
  | { valid: true; value?: string }
  | { valid: false };

/** Extracts the sole bounded `d` value from an authorization URL fragment. */
export function extractAuthorizationFragmentValue(
  hash: string,
): AuthorizationFragmentValue {
  if (hash.length > PUBKY_AUTH_REQUEST_LIMITS.encodedDLength + "#d=".length) {
    return { valid: false };
  }

  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (fragment.length === 0) return { valid: true };

  let value: string | undefined;
  for (const parameter of fragment.split("&")) {
    const separator = parameter.indexOf("=");
    const name = separator === -1 ? parameter : parameter.slice(0, separator);
    if (name !== "d" || separator === -1 || value !== undefined) {
      return { valid: false };
    }
    value = parameter.slice(separator + 1);
  }

  return value === undefined ? { valid: true } : { valid: true, value };
}
