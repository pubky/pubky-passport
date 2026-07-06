import { z } from "zod";

import {
  hasMinimumServerSecretBytes,
  isBase64,
  minimumServerSecretByteLength,
} from "../security/serverSecret";
import { type EnvLike, envUrlSchema, isDevelopmentEnv, requiredStringSchema } from "./url";

export type ServerEnv = {
  GOOGLE_CLIENT_ID: string;
  PASSPORT_SERVER_SECRET_BASE64: string;
  HOMEGATE_URL: string;
  PUBKY_HOMESERVER: string;
};

function serverSecretSchema() {
  return requiredStringSchema("PASSPORT_SERVER_SECRET_BASE64").superRefine((value, context) => {
    if (!isBase64(value)) {
      context.addIssue({
        code: "custom",
        message: "PASSPORT_SERVER_SECRET_BASE64 must be valid base64",
      });
      return;
    }

    const decoded = Buffer.from(value, "base64");

    if (!hasMinimumServerSecretBytes(decoded)) {
      context.addIssue({
        code: "custom",
        message: `PASSPORT_SERVER_SECRET_BASE64 must decode to at least ${minimumServerSecretByteLength()} bytes`,
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
