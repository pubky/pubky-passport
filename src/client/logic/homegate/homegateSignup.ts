import "client-only";

import { z } from "zod";

import {
  homeserverPubkySchema,
  signupTokenSchema,
  type HomeserverSignupDetails,
} from "@/client/logic/signup/homeserverInvite";

const HOMESERVER_FIELD = "homeserverPubky";

/**
 * Homegate's wire format calls the token `signupCode`; the Pubky SDK calls it a signup token.
 * Every Homegate route that issues a code names the homeserver that minted it (the z-base-32
 * `public_key` from that homeserver's admin `/info`), and every released Homegate sends it, so a
 * code without a valid homeserver is refused rather than tried on another one.
 */
export const homegateSignupSchema = z.object({
  signupCode: signupTokenSchema,
  [HOMESERVER_FIELD]: homeserverPubkySchema,
});

export function signupDetails(
  value: z.infer<typeof homegateSignupSchema>,
): HomeserverSignupDetails {
  return { signupToken: value.signupCode, homeserverPubky: value.homeserverPubky };
}

/**
 * Whether a response was refused because its homeserver is missing or not a public key, including
 * inside a union's branches. Only the schema's own field names are compared, never values.
 */
export function refusesHomeserver(issues: readonly z.core.$ZodIssue[]): boolean {
  return issues.some(
    (issue) =>
      issue.path.at(-1) === HOMESERVER_FIELD ||
      (issue.code === "invalid_union" && issue.errors.some(refusesHomeserver)),
  );
}
