import "client-only";

import { z } from "zod";

import { isPubkyPublicKey } from "@/client/logic/pubky/pubkyIdentityKey";

/** A homeserver signup token and the homeserver it unlocks, whichever source issued it. */
export type HomeserverSignupDetails = {
  signupToken: string;
  homeserverPubky: string;
};

export const signupTokenSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => value.trim().length > 0);

export const homeserverPubkySchema = z.string().refine(isPubkyPublicKey);

const CROCKFORD_GROUP = "[0-9A-HJKMNP-TV-Z]{4}";
/** Homeserver signup tokens are 14-character hyphenated Crockford base32: `AAAA-BBBB-CCCC`. */
const INVITE_CODE_PATTERN = new RegExp(
  `^${CROCKFORD_GROUP}-${CROCKFORD_GROUP}-${CROCKFORD_GROUP}$`,
);

/**
 * Normalizes a typed invite code, or returns null when it cannot be a homeserver token. The
 * homeserver answers a malformed token with 400, so such codes never need a lookup.
 */
export function parseInviteCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return INVITE_CODE_PATTERN.test(code) ? code : null;
}

export function sameInvite(a: HomeserverSignupDetails, b: HomeserverSignupDetails): boolean {
  return a.signupToken === b.signupToken && a.homeserverPubky === b.homeserverPubky;
}
