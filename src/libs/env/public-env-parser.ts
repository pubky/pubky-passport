import { z } from "zod";

import { type EnvLike, envUrlSchema, isDevelopmentEnv, requiredStringSchema } from "./env-schema";

export type PublicEnv = {
  NEXT_PUBLIC_PASSPORT_PUBLIC_URL: string;
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: string;
  NEXT_PUBLIC_HTTP_RELAY_URL: string;
  NEXT_PUBLIC_PUBKY_TESTNET_HOST?: string | undefined;
};

export function parsePublicEnv(input: EnvLike): PublicEnv {
  const allowLocalhostHttp = isDevelopmentEnv(input);

  return z
    .object({
      NEXT_PUBLIC_PASSPORT_PUBLIC_URL: envUrlSchema("NEXT_PUBLIC_PASSPORT_PUBLIC_URL", {
        allowLocalhostHttp,
      }),
      NEXT_PUBLIC_GOOGLE_CLIENT_ID: requiredStringSchema("NEXT_PUBLIC_GOOGLE_CLIENT_ID"),
      NEXT_PUBLIC_HTTP_RELAY_URL: envUrlSchema("NEXT_PUBLIC_HTTP_RELAY_URL", {
        allowLocalhostHttp,
      }),
      NEXT_PUBLIC_PUBKY_TESTNET_HOST: z.preprocess(
        (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
        z
          .string()
          .trim()
          .min(1)
          .max(253)
          .regex(/^(?:localhost|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])$/i)
          .optional(),
      ),
    })
    .parse(input);
}
