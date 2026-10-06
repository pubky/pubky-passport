import { base64url } from "./base64url.js";

/** An attempt id: 16 random bytes in base64url, 22 characters. */
export const ATTEMPT_ID = "[A-Za-z0-9_-]{22}";

export function createAttemptId(random: Pick<Crypto, "getRandomValues">): string {
  return base64url(random.getRandomValues(new Uint8Array(16)));
}

export function isAttemptId(value: unknown): value is string {
  return typeof value === "string" && new RegExp(`^${ATTEMPT_ID}$`, "u").test(value);
}
