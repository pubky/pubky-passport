import { z } from "zod";

import {
  hasMinimumServerSecretBytes,
  isBase64,
  minimumServerSecretByteLength,
} from "../security/serverSecret";
import { type EnvLike, envUrlSchema, isDevelopmentEnv, requiredStringSchema } from "./url";

export type GoogleWrappingKeyServerEnv = {
  GOOGLE_CLIENT_ID: string;
  PASSPORT_SERVER_SECRET_BASE64: string;
};

export type HomegateServerEnv = {
  HOMEGATE_URL: string;
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

export function parseGoogleWrappingKeyServerEnv(input: EnvLike): GoogleWrappingKeyServerEnv {
  return z
    .object({
      GOOGLE_CLIENT_ID: requiredStringSchema("GOOGLE_CLIENT_ID"),
      PASSPORT_SERVER_SECRET_BASE64: serverSecretSchema(),
    })
    .parse(input);
}

export function parseHomegateServerEnv(input: EnvLike): HomegateServerEnv {
  const allowLocalhostHttp = isDevelopmentEnv(input);

  return z
    .object({
      HOMEGATE_URL: envUrlSchema("HOMEGATE_URL", { allowLocalhostHttp }),
    })
    .parse(input);
}
