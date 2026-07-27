import "server-only";

import { z } from "zod";

import {
  hasMinimumServerSecretBytes,
  isBase64,
  minimumServerSecretByteLength,
} from "../adapters/serverSecret";

type EnvLike = Record<string, string | undefined>;

export type GoogleWrappingKeyServerConfig = {
  PASSPORT_SERVER_SECRET_BASE64: string;
};

const requiredStringSchema = (name: string) =>
  z.string().trim().min(1, `${name} is required`);

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

export function parseGoogleWrappingKeyServerConfig(input: EnvLike): GoogleWrappingKeyServerConfig {
  return z
    .object({
      PASSPORT_SERVER_SECRET_BASE64: serverSecretSchema(),
    })
    .parse(input);
}

export function getGoogleWrappingKeyServerConfig(): GoogleWrappingKeyServerConfig {
  return parseGoogleWrappingKeyServerConfig(process.env);
}
