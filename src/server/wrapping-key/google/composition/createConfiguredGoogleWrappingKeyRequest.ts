import "server-only";

import { getGoogleClientId } from "../../../config/googleClientId";
import { createGoogleIdTokenVerifier } from "../adapters/googleIdTokenVerifier";
import { createInMemoryGoogleWrappingKeyRateLimiter } from "../adapters/inMemoryGoogleWrappingKeyRateLimiter";
import { createGoogleWrappingKeyMaterial } from "../adapters/googleWrappingKeyMaterial";
import type { GoogleWrappingKeyRequest } from "../application/requestGoogleWrappingKey";
import { createGoogleWrappingKeyRequest } from "../application/requestGoogleWrappingKey";
import { getGoogleWrappingKeyServerConfig } from "./googleWrappingKeyConfig";

export function createConfiguredGoogleWrappingKeyRequest(): GoogleWrappingKeyRequest {
  const env = getGoogleWrappingKeyServerConfig();

  return createGoogleWrappingKeyRequest({
    googleIdTokenVerifier: createGoogleIdTokenVerifier({ audience: getGoogleClientId() }),
    material: createGoogleWrappingKeyMaterial({ serverSecretBase64: env.PASSPORT_SERVER_SECRET_BASE64 }),
    rateLimiter: createInMemoryGoogleWrappingKeyRateLimiter({
      serverSecretBase64: env.PASSPORT_SERVER_SECRET_BASE64,
    }),
    now: () => new Date(),
  });
}
