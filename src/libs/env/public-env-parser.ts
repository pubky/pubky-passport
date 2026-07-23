import { z } from "zod";

import { type EnvLike, envUrlSchema, requiredStringSchema } from "./env-schema";

export type PublicEnv = {
  NEXT_PUBLIC_PASSPORT_PUBLIC_URL: string;
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: string;
};

export function parsePublicEnv(input: EnvLike): PublicEnv {
  return z
    .object({
      NEXT_PUBLIC_PASSPORT_PUBLIC_URL: envUrlSchema("NEXT_PUBLIC_PASSPORT_PUBLIC_URL"),
      NEXT_PUBLIC_GOOGLE_CLIENT_ID: requiredStringSchema("NEXT_PUBLIC_GOOGLE_CLIENT_ID"),
    })
    .parse(input);
}
