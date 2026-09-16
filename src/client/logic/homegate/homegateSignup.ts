import "client-only";

import { z } from "zod";

import { isPubkyPublicKey } from "@/client/logic/pubky/pubkyIdentityKey";

export const homegateSignupSchema = z.object({
  signupCode: z
    .string()
    .min(1)
    .max(1024)
    .refine((value) => value.trim().length > 0),
  homeserverPubky: z.string().refine(isPubkyPublicKey),
});

export type HomeserverSignupDetails = {
  signupToken: string;
  homeserverPubky: string;
};

export function signupDetails(
  value: z.infer<typeof homegateSignupSchema>,
): HomeserverSignupDetails {
  return { signupToken: value.signupCode, homeserverPubky: value.homeserverPubky };
}
