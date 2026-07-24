import "server-only";

import { getGoogleClientId } from "../../config/googleClientId";
import { getGoogleWrappingKeyServerConfig } from "./config";
import { createGoogleIdTokenVerifier } from "./idTokenVerifier";
import { createGoogleWrappingKeyMaterial } from "./keyDeriver";
import { createInMemoryGoogleWrappingKeyRateLimiter } from "./rateLimiter";
import { createGoogleWrappingKeyRequest, type GoogleWrappingKeyRequest } from "./request";

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
