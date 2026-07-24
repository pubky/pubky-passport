import { z } from "zod";

import { parseHomegateBaseUrl } from "../homegate/parseHomegateBaseUrl";
import { type EnvLike, envUrlSchema, requiredStringSchema } from "./env-schema";

export type PublicEnv = {
  NEXT_PUBLIC_PASSPORT_PUBLIC_URL: string;
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: string;
  NEXT_PUBLIC_HOMEGATE_URL: string;
};

export function parsePublicEnv(input: EnvLike): PublicEnv {
  return z
    .object({
      NEXT_PUBLIC_PASSPORT_PUBLIC_URL: envUrlSchema("NEXT_PUBLIC_PASSPORT_PUBLIC_URL"),
      NEXT_PUBLIC_GOOGLE_CLIENT_ID: requiredStringSchema("NEXT_PUBLIC_GOOGLE_CLIENT_ID"),
      NEXT_PUBLIC_HOMEGATE_URL: homegateBaseUrlSchema(),
    })
    .parse(input);
}

function homegateBaseUrlSchema() {
  return requiredStringSchema("NEXT_PUBLIC_HOMEGATE_URL").transform((value, context) => {
    const parsed = parseHomegateBaseUrl(value);
    if (parsed) return parsed.href;

    context.addIssue({
      code: "custom",
      message: "NEXT_PUBLIC_HOMEGATE_URL must be a CSP-safe HTTPS base URL",
    });
    return z.NEVER;
  });
}
