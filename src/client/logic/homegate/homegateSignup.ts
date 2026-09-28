import "client-only";

import { z } from "zod";

import {
  homeserverPubkySchema,
  signupTokenSchema,
  type HomeserverSignupDetails,
} from "@/client/logic/signup/homeserverInvite";

/** Homegate's wire format calls the token `signupCode`; the Pubky SDK calls it a signup token. */
export const homegateSignupSchema = z.object({
  signupCode: signupTokenSchema,
  homeserverPubky: homeserverPubkySchema,
});

export function signupDetails(
  value: z.infer<typeof homegateSignupSchema>,
): HomeserverSignupDetails {
  return { signupToken: value.signupCode, homeserverPubky: value.homeserverPubky };
}
