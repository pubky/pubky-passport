import { z } from "zod";

import { type EnvLike, envUrlSchema, isDevelopmentEnv, requiredStringSchema } from "./url";

const minimumServerSecretBytes = 32;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type ServerEnv = {
  GOOGLE_CLIENT_ID: string;
  PASSPORT_SERVER_SECRET_BASE64: string;
  HOMEGATE_URL: string;
  PUBKY_HOMESERVER: string;
};

function serverSecretSchema() {
  return requiredStringSchema("PASSPORT_SERVER_SECRET_BASE64").superRefine((value, context) => {
    if (!base64Pattern.test(value)) {
      context.addIssue({
        code: "custom",
        message: "PASSPORT_SERVER_SECRET_BASE64 must be valid base64",
      });
      return;
    }

    const decoded = Buffer.from(value, "base64");

    if (decoded.length < minimumServerSecretBytes) {
      context.addIssue({
        code: "custom",
        message: `PASSPORT_SERVER_SECRET_BASE64 must decode to at least ${minimumServerSecretBytes} bytes`,
      });
    }
  });
}

export function parseServerEnv(input: EnvLike): ServerEnv {
  const allowLocalhostHttp = isDevelopmentEnv(input);

  return z
    .object({
      GOOGLE_CLIENT_ID: requiredStringSchema("GOOGLE_CLIENT_ID"),
      PASSPORT_SERVER_SECRET_BASE64: serverSecretSchema(),
      HOMEGATE_URL: envUrlSchema("HOMEGATE_URL", { allowLocalhostHttp }),
      PUBKY_HOMESERVER: envUrlSchema("PUBKY_HOMESERVER", { allowLocalhostHttp }),
    })
    .parse(input);
}
