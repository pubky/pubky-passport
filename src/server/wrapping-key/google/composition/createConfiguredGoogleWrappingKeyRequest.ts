import "server-only";

import { z } from "zod";

import { getGoogleClientId } from "../../../config/googleClientId";
import { createDeriveGoogleWrappingKey } from "../adapters/deriveGoogleWrappingKey";
import { GoogleIdTokenVerifier } from "../adapters/googleIdTokenVerifier";
import { createInMemoryGoogleWrappingKeyRateLimiter } from "../adapters/inMemoryGoogleWrappingKeyRateLimiter";
import {
  createRequestGoogleWrappingKey,
  type RequestGoogleWrappingKey,
} from "../application/requestGoogleWrappingKey";

type EnvLike = Record<string, string | undefined>;

const MINIMUM_SERVER_SECRET_BYTES = 32;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SERVER_SECRET_SCHEMA = z.string()
  .trim()
  .min(1, "PASSPORT_SERVER_SECRET_BASE64 is required")
  .regex(BASE64_PATTERN, "PASSPORT_SERVER_SECRET_BASE64 must be valid base64")
  .transform((value) => Buffer.from(value, "base64"))
  .refine(
    (value) => value.byteLength >= MINIMUM_SERVER_SECRET_BYTES,
    `PASSPORT_SERVER_SECRET_BASE64 must decode to at least ${MINIMUM_SERVER_SECRET_BYTES} bytes`,
  );

export function createConfiguredGoogleWrappingKeyRequest(): RequestGoogleWrappingKey {
  const serverSecret = parseGoogleWrappingKeyServerSecret(process.env);

  try {
    const googleIdTokenVerifier = new GoogleIdTokenVerifier({ audience: getGoogleClientId() });

    return createRequestGoogleWrappingKey({
      googleIdTokenVerifier,
      checkRateLimit: createInMemoryGoogleWrappingKeyRateLimiter({ identityPepper: serverSecret }),
      deriveWrappingKey: createDeriveGoogleWrappingKey({ serverSecret }),
    });
  } finally {
    serverSecret.fill(0);
  }
}

export function parseGoogleWrappingKeyServerSecret(input: EnvLike): Buffer {
  return SERVER_SECRET_SCHEMA.parse(input.PASSPORT_SERVER_SECRET_BASE64);
}
